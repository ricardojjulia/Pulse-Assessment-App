#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_INDEX_URL = "https://developer.dynatrace.com/develop/reference/apis/latest-apis/";
const DEFAULT_OUT = path.join(ROOT, "tools/dynatrace-api-extractor/output");

function parseArgs(argv) {
  const args = {
    indexUrl: DEFAULT_INDEX_URL,
    outDir: process.env.DT_API_EXTRACT_OUT || DEFAULT_OUT,
    token: process.env.DT_TOKEN || "",
    authScheme: process.env.DT_AUTH_SCHEME || "Bearer",
    fetchSpecs: false,
    localOpenapi: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--index-url") args.indexUrl = argv[++i] ?? DEFAULT_INDEX_URL;
    else if (arg === "--out") args.outDir = path.resolve(argv[++i] ?? DEFAULT_OUT);
    else if (arg === "--token") args.token = argv[++i] ?? "";
    else if (arg === "--auth-scheme") args.authScheme = argv[++i] ?? "Bearer";
    else if (arg === "--fetch-specs") args.fetchSpecs = true;
    else if (arg === "--openapi") args.localOpenapi.push(path.resolve(argv[++i] ?? ""));
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Dynatrace Latest API Extractor

Usage:
  npm run dt:api:extract
  DT_TOKEN=... npm run dt:api:extract -- --fetch-specs
  npm run dt:api:extract -- --openapi "/path/to/openapi.yaml"

Options:
  --index-url URL      Latest APIs index page
  --fetch-specs        Fetch Swagger UI config/specs. Requires platform/Bearer auth.
  --openapi FILE       Include a local OpenAPI YAML/JSON file. Repeatable.
  --out DIR            Output directory
`);
}

async function fetchText(url, token = "", authScheme = "Bearer") {
  const headers = token ? { Authorization: `${authScheme} ${token}` } : {};
  const response = await fetch(url, { headers });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(args.outDir, { recursive: true });

  const index = await fetchText(args.indexUrl);
  if (!index.ok) throw new Error(`Failed to fetch ${args.indexUrl}: ${index.status} ${index.statusText}`);
  const catalog = extractIndexCatalog(index.text, args.indexUrl);

  const specs = [];
  const specFailures = [];
  for (const file of args.localOpenapi) {
    const raw = await fs.readFile(file, "utf8");
    specs.push({ source: file, ...summarizeOpenApi(parseOpenApi(raw)) });
  }

  if (args.fetchSpecs) {
    for (const api of catalog.apis) {
      const configUrl = swaggerConfigUrl(api.swaggerUrl);
      const configResponse = await fetchText(configUrl, args.token, args.authScheme);
      if (!configResponse.ok) {
        specFailures.push({
          api: api.name,
          configUrl,
          status: configResponse.status,
          statusText: configResponse.statusText,
        });
        continue;
      }
      const config = safeJson(configResponse.text);
      const specUrl = findSpecUrl(config, api.primaryName);
      if (!specUrl) {
        specFailures.push({ api: api.name, configUrl, status: 0, statusText: "Spec URL not found in Swagger config" });
        continue;
      }
      const absoluteSpecUrl = new URL(specUrl, configUrl).toString();
      const specResponse = await fetchText(absoluteSpecUrl, args.token, args.authScheme);
      if (!specResponse.ok) {
        specFailures.push({
          api: api.name,
          specUrl: absoluteSpecUrl,
          status: specResponse.status,
          statusText: specResponse.statusText,
        });
        continue;
      }
      await fs.writeFile(path.join(args.outDir, `${slug(api.name)}.openapi.raw`), specResponse.text, "utf8");
      specs.push({
        source: absoluteSpecUrl,
        catalogApi: api,
        ...summarizeOpenApi(parseOpenApi(specResponse.text)),
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    indexUrl: args.indexUrl,
    catalog,
    specs,
    specFailures,
  };
  await fs.writeFile(path.join(args.outDir, "latest-api-catalog.json"), JSON.stringify(catalog, null, 2), "utf8");
  await fs.writeFile(path.join(args.outDir, "latest-api-openapi-summary.json"), JSON.stringify(output, null, 2), "utf8");
  await fs.writeFile(path.join(args.outDir, "latest-api-catalog.md"), toMarkdown(output), "utf8");

  console.log(`Extracted ${catalog.apis.length} API catalog entries.`);
  console.log(`Summarized ${specs.length} OpenAPI spec(s).`);
  if (specFailures.length) console.log(`Spec fetch failures: ${specFailures.length}`);
  console.log(`Output: ${args.outDir}`);
}

function extractIndexCatalog(html, indexUrl) {
  const headings = [];
  const headingPattern = /<h3[^>]*id=([^ >]+)[^>]*>(.*?)<\/h3>/gis;
  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    const title = cleanText(headingMatch[2]);
    if (title) headings.push({ index: headingMatch.index, title });
  }

  const apis = [];
  const cardPattern = /<a[^>]+href="([^"]+)"[^>]*class=styledLinkContent[^>]*>.*?<h3[^>]*class=styledTitle[^>]*>(.*?)<\/h3>.*?<div[^>]*class=styledText[^>]*>\s*<p>(.*?)<\/div><\/a>/gis;
  let linkMatch;
  while ((linkMatch = cardPattern.exec(html)) !== null) {
    if (!linkMatch[1].includes("/platform/swagger-ui/index.html") && !linkMatch[1].includes("/rest-api-doc/index.jsp")) continue;
    const href = new URL(decodeEntities(linkMatch[1]), indexUrl).toString();
    const name = cleanText(linkMatch[2]);
    const description = cleanText(linkMatch[3]);
    const category = categoryAt(headings, linkMatch.index);
    if (!name) continue;
    const primaryName = new URL(href).searchParams.get("urls.primaryName") ?? "";
    apis.push({
      category,
      name,
      description,
      primaryName,
      swaggerUrl: href,
      host: new URL(href).host,
    });
  }
  return {
    total: apis.length,
    categories: [...new Set(apis.map((api) => api.category))],
    apis,
  };
}

function categoryAt(headings, index) {
  let category = "Uncategorized";
  for (const heading of headings) {
    if (heading.index > index) break;
    category = heading.title;
  }
  return category;
}

function swaggerConfigUrl(swaggerUrl) {
  const url = new URL(swaggerUrl);
  return `${url.origin}/platform/swagger-ui/swagger-config`;
}

function findSpecUrl(config, primaryName) {
  const urls = config?.urls ?? config?.configUrl?.urls ?? [];
  if (Array.isArray(urls)) {
    const exact = urls.find((item) => item.name === primaryName || item.displayName === primaryName);
    return exact?.url ?? urls[0]?.url ?? null;
  }
  return config?.url ?? null;
}

function summarizeOpenApi(doc) {
  const paths = doc.paths ?? {};
  const operations = [];
  for (const [apiPath, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods ?? {})) {
      if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) continue;
      operations.push({
        method: method.toUpperCase(),
        path: apiPath,
        operationId: operation.operationId ?? "",
        summary: operation.summary ?? "",
        description: operation.description ?? "",
        tags: operation.tags ?? [],
        security: operation.security ?? doc.security ?? [],
        parameters: asArray(operation.parameters).map((param) => ({
          name: param.name,
          in: param.in,
          required: !!param.required,
          description: param.description ?? "",
        })),
        responses: Object.keys(operation.responses ?? {}),
      });
    }
  }
  return {
    title: doc.info?.title ?? "",
    version: doc.info?.version ?? "",
    summary: doc.info?.["x-summary"] ?? doc.info?.description ?? "",
    servers: doc.servers ?? [],
    operationCount: operations.length,
    pathCount: Object.keys(paths).length,
    operations,
    securitySchemes: doc.components?.securitySchemes ?? {},
  };
}

function parseOpenApi(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return parseSimpleYaml(trimmed);
}

function parseSimpleYaml(raw) {
  const result = {};
  const stack = [{ indent: -1, value: result }];
  for (const rawLine of raw.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) continue;
      const item = line.slice(2);
      if (item.includes(":")) {
        const obj = {};
        parent.push(obj);
        assignYamlPair(obj, item);
        stack.push({ indent, value: obj });
      } else {
        parent.push(parseYamlScalar(item));
      }
      continue;
    }
    const [keyPart, ...valueParts] = line.split(":");
    const key = unquote(keyPart.trim());
    const valueText = valueParts.join(":").trim();
    if (valueText === "") {
      const next = {};
      parent[key] = next;
      stack.push({ indent, value: next });
    } else {
      parent[key] = parseYamlScalar(valueText);
    }
  }
  return result;
}

function assignYamlPair(obj, text) {
  const [keyPart, ...valueParts] = text.split(":");
  obj[unquote(keyPart.trim())] = parseYamlScalar(valueParts.join(":").trim());
}

function parseYamlScalar(value) {
  const unquoted = unquote(value);
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function unquote(value) {
  return String(value).replace(/^["']|["']$/g, "");
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, " ");
}

function cleanText(value) {
  return decodeEntities(stripTags(value))
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

function decodeEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "api";
}

function toMarkdown(output) {
  const lines = [
    "# Dynatrace Latest APIs",
    "",
    `Generated: ${output.generatedAt}`,
    `Index: ${output.indexUrl}`,
    "",
    "## Catalog",
    "",
  ];
  for (const category of output.catalog.categories) {
    lines.push(`### ${category}`, "");
    for (const api of output.catalog.apis.filter((item) => item.category === category)) {
      lines.push(`- **${api.name}** — ${api.description || "No description"}`);
      lines.push(`  - Swagger UI: ${api.swaggerUrl}`);
      if (api.primaryName) lines.push(`  - Primary name: ${api.primaryName}`);
    }
    lines.push("");
  }
  if (output.specs.length) {
    lines.push("## OpenAPI Summaries", "");
    for (const spec of output.specs) {
      lines.push(`### ${spec.title || spec.source}`);
      lines.push("");
      lines.push(`- Source: ${spec.source}`);
      lines.push(`- Version: ${spec.version || "N/A"}`);
      lines.push(`- Paths: ${spec.pathCount}`);
      lines.push(`- Operations: ${spec.operationCount}`);
      lines.push("");
      for (const op of spec.operations) {
        lines.push(`- \`${op.method} ${op.path}\` — ${op.summary || op.operationId || "No summary"}`);
      }
      lines.push("");
    }
  }
  if (output.specFailures.length) {
    lines.push("## Spec Fetch Failures", "");
    for (const failure of output.specFailures) {
      lines.push(`- ${failure.api}: ${failure.status} ${failure.statusText}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
