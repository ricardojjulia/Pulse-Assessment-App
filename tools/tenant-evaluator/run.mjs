#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { API_CALLS, SETTINGS_SCHEMA_IDS } from "./lib/api-catalog.mjs";
import { calculateOes } from "./lib/scoring.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUT = path.join(ROOT, "tools/tenant-evaluator/output");
const QUERY_SOURCE = path.join(ROOT, "ui/app/tenantReview/constants/queries.ts");

function parseArgs(argv) {
  const args = {
    envUrl: process.env.DT_ENV_URL || "",
    envApiUrl: process.env.DT_ENV_API_URL || "",
    token: process.env.DT_TOKEN || "",
    authScheme: process.env.DT_AUTH_SCHEME || "auto",
    outDir: process.env.TENANT_EVAL_OUT || DEFAULT_OUT,
    exportOnly: false,
    skipDql: false,
    skipApi: false,
    sampleReport: false,
    authCheck: false,
    timeoutMs: Number(process.env.TENANT_EVAL_TIMEOUT_MS || 60000),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env-url") args.envUrl = argv[++i] ?? "";
    else if (arg === "--env-api-url") args.envApiUrl = argv[++i] ?? "";
    else if (arg === "--token") args.token = argv[++i] ?? "";
    else if (arg === "--auth-scheme") args.authScheme = argv[++i] ?? "auto";
    else if (arg === "--out") args.outDir = path.resolve(argv[++i] ?? DEFAULT_OUT);
    else if (arg === "--export-only") args.exportOnly = true;
    else if (arg === "--skip-dql") args.skipDql = true;
    else if (arg === "--skip-api") args.skipApi = true;
    else if (arg === "--sample-report") args.sampleReport = true;
    else if (arg === "--auth-check") args.authCheck = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++i] ?? 60000);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`ESA Tenant Evaluator CLI

Usage:
  npm run tenant:evaluate -- --env-url https://tenant.apps.dynatrace.com --token "$DT_TOKEN"
  npm run tenant:evaluate -- --export-only

Environment:
  DT_ENV_URL            Dynatrace tenant URL
  DT_ENV_API_URL        Optional Environment API URL, for example https://abc12345.live.dynatrace.com
  DT_TOKEN              Dynatrace API/OAuth token
  DT_AUTH_SCHEME        auto | Api-Token | Bearer  (default: auto)
  TENANT_EVAL_OUT       Output directory
  TENANT_EVAL_TIMEOUT_MS HTTP timeout per request

Options:
  --export-only         Generate DQL/API catalogs without calling Dynatrace
  --env-api-url         Override Environment API base URL for /api/v2 and /api/config calls
  --skip-dql            Skip DQL execution
  --skip-api            Skip REST/API execution
  --sample-report       Write a sample self-contained HTML report
  --auth-check          Test Platform and Environment API authentication only
`);
}

function normalizeEnvUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function deriveEnvironmentApiUrl(envUrl, explicitEnvApiUrl) {
  if (explicitEnvApiUrl) return normalizeEnvUrl(explicitEnvApiUrl);
  const normalized = normalizeEnvUrl(envUrl);
  const match = normalized.match(/^https:\/\/([a-z0-9-]+)\.apps\.dynatrace\.com$/i);
  if (match) return `https://${match[1]}.live.dynatrace.com`;
  return normalized;
}

function baseUrlForApiCall(call, envUrl, envApiUrl) {
  return call.path.startsWith("/api/") ? envApiUrl : envUrl;
}

function authHeaders(token, scheme) {
  const normalizedToken = normalizeToken(token);
  if (scheme === "Api-Token") return [{ Authorization: `Api-Token ${normalizedToken}` }];
  if (scheme === "Bearer") return [{ Authorization: `Bearer ${normalizedToken}` }];
  return [
    { Authorization: `Api-Token ${normalizedToken}` },
    { Authorization: `Bearer ${normalizedToken}` },
  ];
}

function normalizeToken(token) {
  return String(token || "")
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^Api-Token\s+/i, "");
}

async function readCatalogs() {
  const source = await fs.readFile(QUERY_SOURCE, "utf8");
  return {
    dqlQueries: extractStringObject(source, "DQL_QUERIES"),
    settingsSchemasFromSource: extractStringObject(source, "SETTINGS_SCHEMAS"),
  };
}

function extractStringObject(source, constName) {
  const start = source.indexOf(`export const ${constName}`);
  if (start < 0) throw new Error(`Cannot find ${constName} in ${QUERY_SOURCE}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) throw new Error(`Cannot parse ${constName}`);
  const body = source.slice(open + 1, close);
  const result = {};
  const pattern = /(?:^|\n)\s*([A-Za-z0-9_]+):\s*"((?:\\"|[^"])*)"/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    result[match[1]] = match[2].replace(/\\"/g, "\"");
  }
  return result;
}

async function ensureOutputDirs(outDir) {
  await fs.mkdir(outDir, { recursive: true });
}

async function createRunContext(outDir, envUrl, mode) {
  await ensureOutputDirs(outDir);
  const tenant = tenantSlug(envUrl, mode);
  const stamp = dateStamp();
  const base = `${tenant}-${stamp}`;
  const existing = await fs.readdir(outDir).catch(() => []);
  const pattern = new RegExp(`^${escapeRegExp(base)}-run(\\d{2})`);
  const maxRun = existing.reduce((max, file) => {
    const match = file.match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const runNumber = maxRun + 1;
  const runName = `${base}-run${String(runNumber).padStart(2, "0")}`;
  return { outDir, tenant, stamp, runNumber, runName, mode };
}

function tenantSlug(envUrl, fallback) {
  const value = normalizeEnvUrl(envUrl);
  const hostMatch = value.match(/^https:\/\/([^/.]+)/i);
  const raw = hostMatch?.[1] || fallback || "tenant";
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
}

function dateStamp(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}${dd}${yy}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runPath(run, suffix) {
  return path.join(run.outDir, `${run.runName}-${suffix}`);
}

async function writeCatalogs(run, dqlQueries) {
  const dqlDir = runPath(run, "dql");
  await fs.mkdir(dqlDir, { recursive: true });
  await Promise.all(Object.entries(dqlQueries).map(([id, query]) =>
    fs.writeFile(path.join(dqlDir, `${id}.dql`), `${query}\n`, "utf8"),
  ));
  await fs.writeFile(runPath(run, "dql-catalog.json"), JSON.stringify(dqlQueries, null, 2), "utf8");
  await fs.writeFile(runPath(run, "api-catalog.json"), JSON.stringify(API_CALLS, null, 2), "utf8");
  await fs.writeFile(runPath(run, "run-manifest.json"), JSON.stringify({
    runName: run.runName,
    tenant: run.tenant,
    date: run.stamp,
    runNumber: run.runNumber,
    mode: run.mode,
    generatedAt: new Date().toISOString(),
    files: {
      dqlDirectory: `${run.runName}-dql/`,
      dqlCatalog: `${run.runName}-dql-catalog.json`,
      apiCatalog: `${run.runName}-api-catalog.json`,
    },
  }, null, 2), "utf8");
}

async function fetchJsonWithFallback(url, token, scheme, options = {}) {
  const headersToTry = authHeaders(token, scheme);
  let last;
  for (const authHeader of headersToTry) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          ...authHeader,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      const body = text ? safeJson(text) : null;
      last = { ok: response.ok, status: response.status, statusText: response.statusText, body, auth: authHeader.Authorization.split(" ")[0] };
      if (response.ok) return last;
      if (scheme !== "auto" || ![401, 403].includes(response.status)) return last;
    } catch (error) {
      last = { ok: false, status: 0, statusText: error instanceof Error ? error.message : "Request failed", body: null };
    } finally {
      clearTimeout(timer);
    }
  }
  return last;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function runDqlQueries({ envUrl, token, authScheme, timeoutMs, dqlQueries }) {
  const endpoint = `${envUrl}/platform/storage/query/v1/query:execute`;
  const results = {};
  const failures = [];
  for (const [id, query] of Object.entries(dqlQueries)) {
    process.stdout.write(`DQL ${id}... `);
    const response = await fetchJsonWithFallback(endpoint, token, authScheme, {
      method: "POST",
      timeoutMs,
      body: {
        query,
        locale: "en_US",
        timezone: "UTC",
        requestTimeoutMilliseconds: timeoutMs,
        fetchTimeoutSeconds: Math.ceil(timeoutMs / 1000),
      },
    });
    if (response.ok) {
      const records = response.body?.result?.records ?? response.body?.records ?? [];
      results[id] = { records, metadata: response.body?.result?.metadata ?? response.body?.metadata ?? null };
      console.log(`${records.length} record(s)`);
    } else {
      failures.push({ id, status: response.status, statusText: response.statusText, body: response.body });
      results[id] = { records: [], error: `${response.status} ${response.statusText}` };
      console.log(`failed (${response.status} ${response.statusText})`);
    }
  }
  return { results, failures };
}

async function runApiCalls({ envUrl, envApiUrl, token, authScheme, timeoutMs, settingsSchemas }) {
  const results = {};
  const failures = [];
  for (const call of API_CALLS) {
    process.stdout.write(`API ${call.id}... `);
    const response = await fetchJsonWithFallback(`${baseUrlForApiCall(call, envUrl, envApiUrl)}${call.path}`, token, authScheme, {
      method: call.method,
      timeoutMs,
    });
    results[call.id] = response;
    if (response.ok) console.log("ok");
    else {
      failures.push({ id: call.id, status: response.status, statusText: response.statusText, body: response.body });
      console.log(`failed (${response.status} ${response.statusText})`);
    }
  }

  const settingsCounts = {};
  for (const schemaId of settingsSchemas) {
    const encoded = encodeURIComponent(schemaId);
    const url = `${envApiUrl}/api/v2/settings/objects?schemaIds=${encoded}&pageSize=1`;
    process.stdout.write(`Settings ${schemaId}... `);
    const response = await fetchJsonWithFallback(url, token, authScheme, { timeoutMs });
    if (response.ok) {
      const count = response.body?.totalCount ?? response.body?.items?.length ?? response.body?.objects?.length ?? 0;
      settingsCounts[schemaId] = count;
      console.log(count);
    } else {
      settingsCounts[schemaId] = null;
      failures.push({ id: `settings:${schemaId}`, status: response.status, statusText: response.statusText, body: response.body });
      console.log(`failed (${response.status} ${response.statusText})`);
    }
  }

  results.settingsCounts = { ok: true, body: settingsCounts };
  return { results, failures, settingsCounts };
}

async function runAuthCheck({ envUrl, envApiUrl, token, authScheme, timeoutMs }) {
  const checks = [
    {
      id: "platform-management",
      url: `${envUrl}/platform/management/v1/environment`,
      method: "GET",
      note: "Platform bearer token check",
    },
    {
      id: "grail-query",
      url: `${envUrl}/platform/storage/query/v1/query:execute`,
      method: "POST",
      body: {
        query: "fetch dt.system.buckets | limit 1",
        timezone: "UTC",
        locale: "en_US",
        requestTimeoutMilliseconds: timeoutMs,
        fetchTimeoutSeconds: Math.ceil(timeoutMs / 1000),
      },
      note: "DQL/Grail token check",
    },
    {
      id: "environment-settings-schemas",
      url: `${envApiUrl}/api/v2/settings/schemas?pageSize=1`,
      method: "GET",
      note: "Classic Environment API token check",
    },
  ];

  const results = [];
  for (const check of checks) {
    const response = await fetchJsonWithFallback(check.url, token, authScheme, {
      method: check.method,
      body: check.body,
      timeoutMs,
    });
    results.push({
      id: check.id,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      acceptedAuth: response.auth,
      note: check.note,
      hint: authHint(check.id, response.status),
    });
  }
  return results;
}

function authHint(id, status) {
  if (status === 200) return "OK";
  if (status === 401 && id.startsWith("platform")) return "Bearer/OAuth token is missing, expired, not for this tenant, or lacks platform audience.";
  if (status === 401 && id === "grail-query") return "Bearer/OAuth token is not accepted for Grail query execution or lacks storage query/read scopes.";
  if (status === 401) return "Token is missing, expired, or lacks this API scope.";
  if (status === 403) return "Token is accepted but lacks permission/scope for this API.";
  if (status === 404) return "Endpoint/resource is not available on this tenant or base URL.";
  return "";
}

function summarizeWorkflowExecutions(apiResults) {
  const body = apiResults.workflowExecutions?.body;
  const items = body?.results ?? body?.executions ?? body?.items ?? [];
  if (!Array.isArray(items)) return;
  const workflowIds = new Set();
  const summary = {
    totalCount: body?.count ?? body?.totalCount ?? items.length,
    successCount: 0,
    errorCount: 0,
    cancelledCount: 0,
    workflowsWithExecutions: 0,
    triggerTypeCounts: {},
  };
  for (const item of items) {
    const state = String(item.state ?? item.status ?? "").toUpperCase();
    if (state === "SUCCESS" || state === "SUCCEEDED") summary.successCount++;
    else if (state === "ERROR" || state === "FAILED") summary.errorCount++;
    else if (state === "CANCELLED" || state === "CANCELED") summary.cancelledCount++;
    const trigger = item.triggerType ?? item.trigger?.type ?? "Unknown";
    summary.triggerTypeCounts[trigger] = (summary.triggerTypeCounts[trigger] ?? 0) + 1;
    if (item.workflow) workflowIds.add(item.workflow);
    if (item.workflowId) workflowIds.add(item.workflowId);
  }
  summary.workflowsWithExecutions = workflowIds.size;
  apiResults.workflowExecutions.summary = summary;
}

function buildInventory({ dqlResults, apiResults, settingsCounts }) {
  const count = (id, fields = ["count()", "total"]) => {
    for (const field of fields) {
      const value = dqlResults[id]?.records?.[0]?.[field];
      if (typeof value === "number") return value;
    }
    return 0;
  };
  return {
    generatedAt: new Date().toISOString(),
    infrastructure: {
      hosts: count("hostCount"),
      services: count("serviceCount"),
      processGroups: count("processGroupCount"),
      activeGates: apiResults.activeGates?.body?.activeGates?.length ?? count("activeGateCount", ["agCount", "count()"]),
      k8sClusters: count("k8sClusterCount"),
      k8sWorkloads: count("k8sWorkloadCount"),
      k8sNodes: count("k8sNodeCount"),
    },
    data: {
      grailBuckets: dqlResults.grailBuckets?.records?.length ?? 0,
      logRecords24h: sumRecords(dqlResults.logVolumeByLevel?.records, "logCount"),
      events7d: count("eventCount"),
      bizevents24h: count("bizEventVolume", ["total"]),
      spans24h: count("spanCount", ["total"]),
    },
    configuration: {
      settingsSchemas: Object.values(settingsCounts).filter((value) => value !== null).length,
      autoTagRules: settingsCounts["builtin:tags.auto-tagging"] ?? null,
      managementZones: settingsCounts["builtin:management-zones"] ?? null,
      ownershipTeams: settingsCounts["builtin:ownership.teams"] ?? null,
      alertingProfiles: settingsCounts["builtin:alerting.profile"] ?? null,
      workflows: apiResults.workflows?.body?.count ?? apiResults.workflows?.body?.totalCount ?? null,
    },
    access: {
      apiTokens: apiResults.apiTokens?.body?.totalCount ?? apiResults.apiTokens?.body?.apiTokens?.length ?? null,
      enabledApiTokens: Array.isArray(apiResults.apiTokens?.body?.apiTokens)
        ? apiResults.apiTokens.body.apiTokens.filter((token) => token.enabled).length
        : null,
    },
  };
}

function buildGen3Adoption({ dqlResults, apiResults, settingsCounts }) {
  const checks = [
    ["Grail buckets", (dqlResults.grailBuckets?.records?.length ?? 0) > 0],
    ["Logs in Grail", sumRecords(dqlResults.logVolumeByLevel?.records, "logCount") > 0],
    ["Events in Grail", Number(dqlResults.eventCount?.records?.[0]?.["count()"] ?? 0) > 0],
    ["Spans in Grail", Number(dqlResults.spanCount?.records?.[0]?.total ?? 0) > 0],
    ["Business events", Number(dqlResults.bizEventVolume?.records?.[0]?.total ?? 0) > 0],
    ["OpenPipeline", (dqlResults.openPipelineIngestByConfig?.records?.length ?? 0) > 0 || (settingsCounts["builtin:openpipeline.logs.pipelines"] ?? 0) > 0],
    ["Automation workflows", (apiResults.workflows?.body?.count ?? apiResults.workflows?.body?.totalCount ?? 0) > 0],
    ["Ownership", (settingsCounts["builtin:ownership.teams"] ?? 0) > 0],
    ["Segments", (settingsCounts["builtin:segment"] ?? 0) > 0],
    ["Davis anomaly detectors", (settingsCounts["builtin:davis.anomaly-detectors"] ?? 0) > 0],
  ];
  const passed = checks.filter(([, ok]) => ok).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    passed,
    total: checks.length,
    checks: checks.map(([name, passedCheck]) => ({ name, passed: passedCheck })),
  };
}

function sumRecords(items = [], field) {
  return items.reduce((sum, item) => sum + Number(item?.[field] ?? 0), 0);
}

async function writeReports(run, report, evidence = {}) {
  const detailedEvidence = {
    run: {
      runName: run.runName,
      tenant: run.tenant,
      date: run.stamp,
      runNumber: run.runNumber,
      mode: run.mode,
    },
    report,
    collected: evidence,
  };
  await fs.writeFile(runPath(run, "tenant-evaluation.json"), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(runPath(run, "detailed-evidence.json"), JSON.stringify(detailedEvidence, null, 2), "utf8");
  await fs.writeFile(runPath(run, "oes-pillars.csv"), toPillarCsv(report.oes), "utf8");
  await fs.writeFile(runPath(run, "summary.html"), toHtml(report), "utf8");
}

function toPillarCsv(oes) {
  const lines = ["pillar,weight,score,evidence,value,evidence_score,note"];
  for (const pillar of oes.pillars ?? []) {
    for (const evidence of pillar.evidence ?? []) {
      lines.push([
        pillar.title,
        pillar.weight,
        pillar.score,
        evidence.label,
        evidence.value,
        evidence.score,
        evidence.note,
      ].map(csvEscape).join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toHtml(report) {
  const pillars = report.oes.pillars ?? [];
  const inventoryRows = flattenObject(report.inventory)
    .filter((row) => row.path !== "generatedAt")
    .map((row) => `<tr><td>${escapeHtml(row.path)}</td><td>${escapeHtml(formatValue(row.value))}</td></tr>`)
    .join("");
  const gen3Rows = (report.gen3Adoption.checks ?? [])
    .map((check) => `<tr><td>${escapeHtml(check.name)}</td><td><span class="pill ${check.passed ? "ok" : "warn"}">${check.passed ? "Pass" : "Gap"}</span></td></tr>`)
    .join("");
  const pillarCards = pillars.map((pillar) => `
    <article class="card">
      <div class="card-head">
        <div>
          <h3>${escapeHtml(pillar.title)}</h3>
          <p>${pillar.weight}% of OES</p>
        </div>
        <b class="${scoreClass(pillar.score)}">${pillar.score}</b>
      </div>
      <div class="bar"><i class="${scoreClass(pillar.score)}" style="width:${pillar.score}%"></i></div>
      <table>
        <thead><tr><th>Evidence</th><th>Value</th><th>Score</th><th>Note</th></tr></thead>
        <tbody>
          ${(pillar.evidence ?? []).map((e) => `
            <tr>
              <td>${escapeHtml(e.label)}</td>
              <td>${escapeHtml(e.value)}</td>
              <td><b class="${scoreClass(e.score)}">${e.score}</b></td>
              <td>${escapeHtml(e.note)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `).join("");
  const recommendations = topRecommendations(report.oes)
    .map((item, index) => `
      <li>
        <b>${index + 1}. ${escapeHtml(item.evidence.label)}</b>
        <span class="${scoreClass(item.evidence.score)}">${item.evidence.score}</span>
        <p>${escapeHtml(actionFor(item.pillar, item.evidence))}</p>
      </li>
    `)
    .join("");
  const dqlFailures = (report.failures?.dql ?? [])
    .map((failure) => `<tr><td>${escapeHtml(failure.id)}</td><td>${escapeHtml(failure.status)}</td><td>${escapeHtml(failure.statusText)}</td></tr>`)
    .join("");
  const apiFailures = (report.failures?.api ?? [])
    .map((failure) => `<tr><td>${escapeHtml(failure.id)}</td><td>${escapeHtml(failure.status)}</td><td>${escapeHtml(failure.statusText)}</td></tr>`)
    .join("");
  const embeddedJson = escapeHtml(JSON.stringify(report, null, 2));

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ESA Tenant Evaluation</title>
  <style>
    :root{--ink:#30314d;--muted:#686b80;--soft:#f7f7fa;--line:#e2e4ee;--blue:#4f56d9;--green:#19705f;--amber:#a76500;--red:#b3261e;--purple:#7c3fb0}
    *{box-sizing:border-box} body{font-family:Inter,Arial,sans-serif;background:var(--soft);color:var(--ink);margin:0;padding:32px;line-height:1.45}
    main{max-width:1180px;margin:auto} h1,h2,h3{margin:0} p{color:var(--muted);margin:6px 0 0}
    .hero,.section,.card{background:#fff;border-radius:8px;border:1px solid var(--line);border-top:3px solid var(--blue)}
    .hero{padding:28px;margin-bottom:18px}.hero-grid{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center}
    .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:2px;font-weight:900;color:var(--blue)}
    .score{font-size:78px;font-weight:950;line-height:1}.status{font-size:18px;font-weight:900}
    .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}.kpi{background:#fff;border:1px solid var(--line);border-radius:8px;padding:14px}.kpi b{display:block;font-size:28px}.kpi span{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);font-weight:850}
    .section{padding:22px;margin:18px 0}.section-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{padding:18px}.card-head{display:flex;justify-content:space-between;gap:14px;margin-bottom:12px}.card-head b{font-size:34px}
    .bar{height:8px;background:#ececf1;border-radius:999px;overflow:hidden;margin:10px 0 16px}.bar i{display:block;height:100%;border-radius:999px;background:var(--blue)}
    .good{color:var(--green)!important}.mid{color:var(--amber)!important}.bad{color:var(--red)!important}.good.bar,.bar i.good{background:var(--green)}.mid.bar,.bar i.mid{background:var(--amber)}.bad.bar,.bar i.bad{background:var(--red)}
    table{width:100%;border-collapse:collapse;font-size:12px} th{text-align:left;color:var(--muted);text-transform:uppercase;letter-spacing:.7px;font-size:10px} th,td{padding:9px 8px;border-top:1px solid #eef0f5;vertical-align:top}
    .pill{display:inline-block;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:900}.pill.ok{background:#e9f7f2;color:var(--green)}.pill.warn{background:#fff4de;color:var(--amber)}
    .actions{padding-left:20px}.actions li{margin:12px 0}.actions b{display:inline-block;min-width:280px}.actions span{float:right;font-weight:950}.actions p{margin-top:3px}
    details{background:#fff;border:1px solid var(--line);border-radius:8px;margin:18px 0;padding:14px} summary{cursor:pointer;font-weight:900;color:var(--blue)} pre{white-space:pre-wrap;overflow:auto;background:#111827;color:#e5e7eb;padding:16px;border-radius:6px;font-size:11px}
    .empty{color:var(--muted);font-style:italic}.footer{font-size:11px;color:var(--muted);text-align:center;margin-top:22px}
    @media(max-width:850px){body{padding:16px}.hero-grid,.grid,.kpis{grid-template-columns:1fr}.score{font-size:56px}}
    @media print{body{background:#fff;padding:0}.section,.hero,.card,details{break-inside:avoid} details pre{max-height:none}}
  </style>
</head>
<body><main>
  <div class="hero">
    <div class="hero-grid">
      <div>
        <div class="eyebrow">Dynatrace Platform</div>
        <h1>ESA Tenant Evaluation</h1>
        <p>${escapeHtml(report.environmentUrl || "Local/offline report")} · Generated ${escapeHtml(report.generatedAt)}</p>
        ${report.environmentApiUrl ? `<p>Environment API: ${escapeHtml(report.environmentApiUrl)}</p>` : ""}
        <p>Inventory, Gen3 Adoption, and Overall Effective Score generated locally without deploying the Dynatrace app.</p>
      </div>
      <div>
        <div class="score ${scoreClass(report.oes.overallScore)}">${report.oes.overallScore}</div>
        <div class="status ${scoreClass(report.oes.overallScore)}">${escapeHtml(report.oes.status)}</div>
      </div>
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><b>${escapeHtml(formatValue(report.inventory.infrastructure.hosts))}</b><span>Hosts</span></div>
    <div class="kpi"><b>${escapeHtml(formatValue(report.inventory.infrastructure.services))}</b><span>Services</span></div>
    <div class="kpi"><b>${report.gen3Adoption.score}</b><span>Gen3 Adoption</span></div>
    <div class="kpi"><b>${(report.failures.dql.length + report.failures.api.length)}</b><span>Collection Gaps</span></div>
  </div>

  <section class="section">
    <div class="section-head">
      <div><h2>Executive Summary</h2><p>OES = Signals & Trust 35% + Automation 35% + Foundation 20% + Engagement 10%.</p></div>
    </div>
    <div class="grid">
      ${pillars.map((pillar) => `
        <div>
          <h3>${escapeHtml(pillar.title)} <span class="${scoreClass(pillar.score)}">${pillar.score}</span></h3>
          <div class="bar"><i class="${scoreClass(pillar.score)}" style="width:${pillar.score}%"></i></div>
        </div>
      `).join("")}
    </div>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>Highest ROI Actions</h2><p>Lowest-scoring evidence points across all OES pillars.</p></div></div>
    <ol class="actions">${recommendations || "<li class=\"empty\">No recommendations available.</li>"}</ol>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>Tenant Inventory</h2><p>Summary facts collected through DQL and API calls.</p></div></div>
    <table><tbody>${inventoryRows}</tbody></table>
  </section>

  <section class="section">
    <div class="section-head">
      <div><h2>Gen3 Adoption</h2><p>${report.gen3Adoption.passed} of ${report.gen3Adoption.total} checks passed.</p></div>
      <div class="score ${scoreClass(report.gen3Adoption.score)}" style="font-size:46px">${report.gen3Adoption.score}</div>
    </div>
    <table><thead><tr><th>Check</th><th>Status</th></tr></thead><tbody>${gen3Rows}</tbody></table>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>OES Pillar Evidence</h2><p>Detailed scoring evidence used to calculate the final score.</p></div></div>
    <div class="grid">${pillarCards}</div>
  </section>

  <section class="section">
    <div class="section-head"><div><h2>Collection Gaps</h2><p>Queries or API calls that failed because of permissions, unavailable data objects, or tenant configuration.</p></div></div>
    <h3>DQL</h3>
    <table><thead><tr><th>ID</th><th>Status</th><th>Message</th></tr></thead><tbody>${dqlFailures || "<tr><td colspan=\"3\" class=\"empty\">No DQL failures recorded.</td></tr>"}</tbody></table>
    <h3 style="margin-top:18px">API</h3>
    <table><thead><tr><th>ID</th><th>Status</th><th>Message</th></tr></thead><tbody>${apiFailures || "<tr><td colspan=\"3\" class=\"empty\">No API failures recorded.</td></tr>"}</tbody></table>
  </section>

  <details>
    <summary>Embedded Evidence JSON</summary>
    <pre>${embeddedJson}</pre>
  </details>

  <div class="footer">ESA Tenant Evaluator CLI · Self-contained HTML report</div>
</main></body></html>`;
}

function scoreClass(score) {
  if (score >= 75) return "good";
  if (score >= 45) return "mid";
  return "bad";
}

function flattenObject(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [{ path: prefix, value }];
  }
  return Object.entries(value).flatMap(([key, child]) => flattenObject(child, prefix ? `${prefix}.${key}` : key));
}

function formatValue(value) {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function topRecommendations(oes) {
  return (oes.pillars ?? [])
    .flatMap((pillar) => (pillar.evidence ?? []).map((evidence) => ({ pillar, evidence })))
    .sort((a, b) => a.evidence.score - b.evidence.score)
    .slice(0, 6);
}

function actionFor(pillar, evidence) {
  if (pillar.id === "automation") return "Create or harden workflows for Davis problem routing, owner notification, and low-risk remediation.";
  if (pillar.id === "signals") return "Tune Davis signal quality, connect issue tracking, and reduce recurring alert noise.";
  if (pillar.id === "foundation") return "Standardize ownership, tags, segments, and OpenPipeline routing so signals can be trusted and assigned.";
  if (pillar.id === "engagement") return "Increase operational engagement with shared dashboards, notebooks, lookup tables, and regular Grail usage.";
  return evidence.note;
}

function sampleReport() {
  const settingsCounts = {
    "builtin:ownership.teams": 4,
    "builtin:ownership.config": 2,
    "builtin:tags.auto-tagging": 26,
    "builtin:management-zones": 8,
    "builtin:segment": 1,
    "builtin:issue-tracking.integration": 1,
    "builtin:anomaly-detection.frequent-issues": 1,
    "builtin:openpipeline.logs.pipelines": 1,
    "builtin:openpipeline.metrics.pipelines": 0,
    "builtin:alerting.profile": 12,
  };
  const dqlResults = {
    hostCount: { records: [{ "count()": 773 }] },
    serviceCount: { records: [{ "count()": 907 }] },
    processGroupCount: { records: [{ "count()": 1436 }] },
    k8sClusterCount: { records: [{ "count()": 0 }] },
    k8sWorkloadCount: { records: [{ "count()": 0 }] },
    k8sNodeCount: { records: [{ "count()": 0 }] },
    grailBuckets: { records: Array.from({ length: 30 }, (_, index) => ({ name: `bucket-${index + 1}` })) },
    logVolumeByLevel: { records: [{ loglevel: "INFO", logCount: 27748789 }, { loglevel: "WARN", logCount: 13527325 }] },
    eventCount: { records: [{ "count()": 505125 }] },
    bizEventVolume: { records: [{ total: 0 }] },
    spanCount: { records: [{ total: 259922840 }] },
    recentProblems: { records: [{ "count()": 10302 }] },
    problemsByStatus: { records: [{ "event.status": "ACTIVE", "count()": 6726 }, { "event.status": "CLOSED", "count()": 3576 }] },
    davisEvents: { records: [{ total: 112318 }] },
    workflowExecutionHealth: { records: [{ total: 40, successRate: 92 }] },
    deploymentEvents: { records: [{ total: 18 }] },
    auditLogRecentActivity: { records: [{ total: 2200, uniqueUsers: 19 }] },
    bizeventsDataQuality: { records: [{ total: 0, withType: 0 }] },
    spanDataQuality: { records: [{ total: 259922840, withServiceName: 240000000 }] },
    debugLogVolume: { records: [{ total: 68058116, debugCount: 12667373 }] },
    openPipelineIngestByConfig: { records: [{ configuration: "default/spans", total: 122341801 }, { configuration: "default/metrics", total: 63976285 }] },
  };
  const apiResults = {
    activeGates: { body: { activeGates: Array.from({ length: 15 }, (_, index) => ({ id: `ag-${index}` })) } },
    apiTokens: { body: { totalCount: 178, apiTokens: Array.from({ length: 178 }, (_, index) => ({ enabled: index < 172 })) } },
    workflows: { body: { count: 4 } },
    workflowExecutions: { body: {}, summary: { totalCount: 40, successCount: 37, errorCount: 3, cancelledCount: 0, workflowsWithExecutions: 4 } },
    grailDashboards: { body: { totalCount: 77 } },
    notebooks: { body: { totalCount: 4 } },
    documentShares: { body: { totalCount: 0 } },
  };
  return {
    generatedAt: new Date().toISOString(),
    environmentUrl: "sample://esa-tenant-evaluator",
    inventory: buildInventory({ dqlResults, apiResults, settingsCounts }),
    gen3Adoption: buildGen3Adoption({ dqlResults, apiResults, settingsCounts }),
    oes: calculateOes({ dqlResults, apiResults, settingsCounts }),
    failures: {
      dql: [{ id: "smartscapeHosts", status: 403, statusText: "Permission unavailable in sample" }],
      api: [],
    },
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[char]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envUrl = normalizeEnvUrl(args.envUrl);
  const envApiUrl = deriveEnvironmentApiUrl(envUrl, args.envApiUrl);
  const mode = args.sampleReport ? "sample" : args.exportOnly ? "catalog" : "tenant";
  const run = await createRunContext(args.outDir, envUrl, mode);
  const { dqlQueries, settingsSchemasFromSource } = await readCatalogs();
  const settingsSchemas = Array.from(new Set([...SETTINGS_SCHEMA_IDS, ...Object.values(settingsSchemasFromSource)]));
  await writeCatalogs(run, dqlQueries);

  if (args.sampleReport) {
    const report = sampleReport();
    await writeReports(run, report, {
      dqlQueries,
      apiCalls: API_CALLS,
      settingsSchemas,
      note: "Sample data generated locally for report preview.",
    });
    console.log(`Run name: ${run.runName}`);
    console.log(`Wrote sample self-contained report to ${runPath(run, "summary.html")}`);
    return;
  }

  if (args.exportOnly) {
    console.log(`Run name: ${run.runName}`);
    console.log(`Exported ${Object.keys(dqlQueries).length} DQL files and ${API_CALLS.length} API call definitions to ${args.outDir}`);
    return;
  }
  if (!envUrl || !args.token) {
    throw new Error("DT_ENV_URL and DT_TOKEN are required unless --export-only is used.");
  }
  console.log(`Platform URL: ${envUrl}`);
  console.log(`Environment API URL: ${envApiUrl}`);

  if (args.authCheck) {
    const checks = await runAuthCheck({
      envUrl,
      envApiUrl,
      token: args.token,
      authScheme: args.authScheme,
      timeoutMs: args.timeoutMs,
    });
    for (const check of checks) {
      console.log(`${check.id}: ${check.ok ? "ok" : "failed"} (${check.status} ${check.statusText}) via ${check.acceptedAuth ?? "n/a"}`);
      if (check.hint && check.hint !== "OK") console.log(`  hint: ${check.hint}`);
    }
    return;
  }

  const dql = args.skipDql
    ? { results: {}, failures: [] }
    : await runDqlQueries({ envUrl, token: args.token, authScheme: args.authScheme, timeoutMs: args.timeoutMs, dqlQueries });
  const api = args.skipApi
    ? { results: {}, failures: [], settingsCounts: {} }
    : await runApiCalls({ envUrl, envApiUrl, token: args.token, authScheme: args.authScheme, timeoutMs: args.timeoutMs, settingsSchemas });
  summarizeWorkflowExecutions(api.results);

  const report = {
    generatedAt: new Date().toISOString(),
    environmentUrl: envUrl,
    environmentApiUrl: envApiUrl,
    inventory: buildInventory({ dqlResults: dql.results, apiResults: api.results, settingsCounts: api.settingsCounts }),
    gen3Adoption: buildGen3Adoption({ dqlResults: dql.results, apiResults: api.results, settingsCounts: api.settingsCounts }),
    oes: calculateOes({ dqlResults: dql.results, apiResults: api.results, settingsCounts: api.settingsCounts }),
    failures: {
      dql: dql.failures,
      api: api.failures,
    },
  };
  await fs.writeFile(runPath(run, "dql-results.json"), JSON.stringify(dql.results, null, 2), "utf8");
  await fs.writeFile(runPath(run, "api-results.json"), JSON.stringify(api.results, null, 2), "utf8");
  await writeReports(run, report, {
    dqlQueries,
    apiCalls: API_CALLS,
    settingsSchemas,
    dqlResults: dql.results,
    apiResults: api.results,
    settingsCounts: api.settingsCounts,
    failures: {
      dql: dql.failures,
      api: api.failures,
    },
  });
  console.log(`\nWrote tenant evaluator output to ${args.outDir}`);
  console.log(`Run name: ${run.runName}`);
  console.log(`Summary HTML: ${runPath(run, "summary.html")}`);
  console.log(`Detailed evidence: ${runPath(run, "detailed-evidence.json")}`);
  console.log(`OES: ${report.oes.overallScore} (${report.oes.status})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
