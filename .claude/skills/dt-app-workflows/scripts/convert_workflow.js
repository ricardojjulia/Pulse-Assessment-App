#!/usr/bin/env node
/**
 * Dynatrace Workflow Format Converter
 *
 * Converts between JSON and YAML formats for Workflow definitions.
 * Handles YAML-specific gotchas (quoted "y" key, Jinja preservation).
 *
 * Requirements: Node 22+, npm install (js-yaml)
 *
 * Usage:
 *   node scripts/convert_workflow.js <input-file> [output-file]
 *   node scripts/convert_workflow.js workflow.json              # → workflow.yaml
 *   node scripts/convert_workflow.js workflow.yaml              # → workflow.json
 *   node scripts/convert_workflow.js workflow.yaml output.json  # explicit output
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    stdout: { type: 'boolean', default: false },
    indent: { type: 'string', short: 'i', default: '2' },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Dynatrace Workflow Format Converter

Usage:
  node scripts/convert_workflow.js <input-file> [output-file] [options]

Arguments:
  input-file    Source file (.json or .yaml/.yml)
  output-file   Target file (optional, auto-detected from input)

Options:
  --stdout      Print to stdout instead of writing file
  -i, --indent  Indentation spaces (default: 2)
  -h, --help    Show this help

Examples:
  node scripts/convert_workflow.js workflow.json         → workflow.yaml
  node scripts/convert_workflow.js workflow.yaml         → workflow.json
  node scripts/convert_workflow.js workflow.json out.yaml → out.yaml
  node scripts/convert_workflow.js workflow.yaml --stdout → YAML → JSON to stdout
  node scripts/convert_workflow.js workflow.json --stdout → JSON → YAML to stdout

Notes:
  - YAML output quotes the "y" key in position objects to prevent boolean parsing
  - JSON output uses escaped newlines for multi-line strings
  - Jinja expressions ({{ }}, {% %}) are preserved in both formats
`);
  process.exit(0);
}

const inputPath = positionals[0];
const indent = parseInt(values.indent, 10);

// ---------------------------------------------------------------------------
// YAML loader
// ---------------------------------------------------------------------------

async function loadYaml() {
  try {
    const mod = await import('js-yaml');
    return mod.default ?? mod;
  } catch {
    console.error('Error: js-yaml not installed. Run: npm install');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Determine output format and path
// ---------------------------------------------------------------------------

function getOutputInfo(inputFile, explicitOutput) {
  const inputExt = extname(inputFile).toLowerCase();
  const inputBase = basename(inputFile, inputExt);
  const inputDir = dirname(inputFile);

  if (explicitOutput) {
    const outputExt = extname(explicitOutput).toLowerCase();
    return {
      path: explicitOutput,
      format: outputExt === '.json' ? 'json' : 'yaml',
    };
  }

  // Auto-detect: opposite format
  return inputExt === '.json'
    ? { path: join(inputDir, `${inputBase}.yaml`), format: 'yaml' }
    : { path: join(inputDir, `${inputBase}.json`), format: 'json' };
}

// ---------------------------------------------------------------------------
// Parse input file
// ---------------------------------------------------------------------------

async function parseInput(filePath) {
  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const content = readFileSync(filePath, 'utf-8');
  const ext = extname(filePath).toLowerCase();
  const yaml = await loadYaml();

  try {
    if (ext === '.json') {
      return JSON.parse(content);
    }
    if (ext === '.yaml' || ext === '.yml') {
      return yaml.load(content);
    }
    console.error(`Error: Unsupported file extension: ${ext}`);
    process.exit(1);
  } catch (e) {
    console.error(`Error parsing ${filePath}: ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Convert to JSON
// ---------------------------------------------------------------------------

function toJson(data) {
  return JSON.stringify(data, null, indent) + '\n';
}

// ---------------------------------------------------------------------------
// Convert to YAML
// ---------------------------------------------------------------------------

async function toYaml(data) {
  const yaml = await loadYaml();
  const yamlStr = yaml.dump(data, {
    indent,
    lineWidth: -1,  // disable line wrapping (preserve Jinja expressions on one line)
    noRefs: true,    // no YAML anchors/aliases
    quotingType: '"',
    forceQuotes: false,
    flowLevel: -1,   // always use block style (safer for Jinja in multi-line strings)
  });
  return postProcessYaml(yamlStr);
}

/**
 * Post-process YAML to quote "y" keys.
 * js-yaml v4 dump() does not automatically quote the bare `y` key,
 * which YAML 1.1 parsers interpret as boolean true.
 */
function postProcessYaml(yamlStr) {
  return yamlStr.replace(/^(\s*)y:/gm, '$1"y":');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const data = await parseInput(inputPath);
  const { path: outputPath, format } = getOutputInfo(inputPath, positionals[1]);

  const output = format === 'json' ? toJson(data) : await toYaml(data);

  if (values.stdout) {
    process.stdout.write(output);
  } else {
    writeFileSync(outputPath, output, 'utf-8');
    console.log(`Converted: ${inputPath} → ${outputPath}`);
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e.message);
  process.exit(1);
});
