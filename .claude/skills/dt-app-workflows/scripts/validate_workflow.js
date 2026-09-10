#!/usr/bin/env node
/**
 * Dynatrace Workflow Validator
 *
 * Strict validation of Workflow JSON/YAML files against the official
 * Automation API OpenAPI spec (WorkflowCreate schema).
 *
 * Authoritative spec:
 *   assets/workflow_api_public_spec.yaml  — WorkflowCreate, Task, Trigger schemas
 *   assets/workflow_api_reserved_spec.yaml — expression-preview endpoint
 *
 * Requirements: Node 22+, npm install (js-yaml)
 *
 * Usage:
 *   node scripts/validate_workflow.js <file.json|file.yaml>
 *   node scripts/validate_workflow.js workflow.yaml --verbose
 *   node scripts/validate_workflow.js workflow.json --strict
 */

import { readFileSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  options: {
    verbose: { type: 'boolean', short: 'v', default: false },
    strict: { type: 'boolean', short: 's', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Dynatrace Workflow Validator  (strict, spec-aligned)

Usage:
  node scripts/validate_workflow.js <file.json|file.yaml> [options]

Options:
  -v, --verbose   Show detailed validation output including paths
  -s, --strict    Treat warnings as errors (exit 1 on warnings)
  -h, --help      Show this help

Validates against the official Automation API WorkflowCreate schema.
`);
  process.exit(0);
}

const filePath = resolve(positionals[0]);
const verbose = values.verbose;
const strict = values.strict;

// ---------------------------------------------------------------------------
// Result collectors
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];

const log = (msg) => { if (verbose) console.log(`  [debug] ${msg}`); };
const addError = (msg, path = '') => { errors.push({ message: msg, path }); };
const addWarn = (msg, path = '') => { warnings.push({ message: msg, path }); };

// ---------------------------------------------------------------------------
// Constants from official OpenAPI spec
// ---------------------------------------------------------------------------

// TaskConditionOption.states enum
const VALID_CONDITION_STATES = ['SUCCESS', 'ERROR', 'ANY', 'OK', 'NOK'];

// TaskConditionOption.else enum (Else schema)
const VALID_ELSE_VALUES = ['SKIP', 'STOP'];

// OwnerType enum
const VALID_OWNER_TYPES = ['USER', 'GROUP'];

// WorkflowType enum
const VALID_WORKFLOW_TYPES = ['STANDARD', 'SIMPLE'];

// ScheduleTrigger types
const VALID_SCHEDULE_TRIGGER_TYPES = ['cron', 'interval', 'time', 'once'];

// EventTriggerConfig types
const VALID_EVENT_TRIGGER_TYPES = ['davis-event', 'davis-problem', 'event'];

// EventType enum
const VALID_EVENT_TYPES = ['events', 'bizevents', 'dt.system.events', 'security.events'];

// EntityTagsMatch enum
const VALID_ENTITY_TAGS_MATCH = ['all', 'any'];

// DavisEventNameMatch enum
const VALID_EVENT_NAME_MATCH = ['equals', 'contains'];

// maintenanceWindowTriggerBehavior values (from DavisEventConfig/DavisProblemConfig)
const VALID_MAINTENANCE_BEHAVIORS = ['always', 'paused_while_in_window'];

// DavisProblemCategories — all 7 official categories
const VALID_PROBLEM_CATEGORIES = [
  'monitoringUnavailable', 'availability', 'error',
  'slowdown', 'resource', 'custom', 'info',
];

// Task.action pattern from spec
const ACTION_PATTERN = /^.+:.+$/;

// Task.concurrency — either Jinja or integer 1-99
const JINJA_PATTERN = /^\{\{.+\}\}$/;

// TimeTrigger.time pattern
const TIME_PATTERN = /^([0-1]\d|2[0-3]):[0-5]\d$/;

// OnceTrigger.at pattern
const ONCE_AT_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/;

// IntervalTrigger.betweenStart/betweenEnd pattern
const BETWEEN_TIME_PATTERN = /^([0-1]\d|2[0-3]):[0-5]\d$/;

// Known Jinja workflow functions
const KNOWN_JINJA_FUNCTIONS = [
  'event', 'result', 'input', 'execution', 'task',
  'environment', 'connection', 'now', 'timedelta',
  'calendars', 'scheduling_rules', 'scheduling_rules_includes',
  'scheduling_rules_preview', 'seconds_before', 'executions', 'workflows',
];

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
// Parse input file
// ---------------------------------------------------------------------------

async function parseFile(path) {
  if (!existsSync(path)) {
    console.error(`Error: File not found: ${path}`);
    process.exit(1);
  }

  const content = readFileSync(path, 'utf-8');
  const ext = extname(path).toLowerCase();

  if (ext === '.json') {
    try {
      return JSON.parse(content);
    } catch (e) {
      addError(`Invalid JSON: ${e.message}`);
      return null;
    }
  }

  if (ext === '.yaml' || ext === '.yml') {
    const yaml = await loadYaml();
    try {
      const parsed = yaml.load(content);
      checkYamlGotchas(content);
      return parsed;
    } catch (e) {
      addError(`Invalid YAML: ${e.message}`);
      return null;
    }
  }

  addError(`Unsupported file extension: ${ext}. Use .json, .yaml, or .yml`);
  return null;
}

// ---------------------------------------------------------------------------
// YAML gotcha checks (run on raw text before parsing)
// ---------------------------------------------------------------------------

function checkYamlGotchas(content) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const num = i + 1;

    // Unquoted y: key → parsed as boolean true by YAML 1.1
    if (/^\s+y\s*:/.test(line) && !/^\s+["']y["']\s*:/.test(line)) {
      addWarn(
        `Line ${num}: Unquoted 'y' key will be parsed as boolean true in YAML 1.1. Use '"y":' instead.`,
        `line:${num}`,
      );
    }

    // ON/OFF/YES/NO as values → boolean coercion
    if (/:\s+(on|off|yes|no)\s*$/i.test(line)) {
      const match = line.match(/:\s+(on|off|yes|no)\s*$/i);
      if (match) {
        addWarn(
          `Line ${num}: '${match[1]}' may be parsed as boolean. Quote it if a string is intended.`,
          `line:${num}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isJinjaExpression(val) {
  return typeof val === 'string' && JINJA_PATTERN.test(val.trim());
}

function isIntInRange(val, min, max) {
  return Number.isInteger(val) && val >= min && val <= max;
}

function checkStringField(obj, field, path, { required = false, minLength, maxLength } = {}) {
  const val = obj[field];
  if (val === undefined || val === null) {
    if (required) addError(`Missing required field: ${field}`, path);
    return;
  }
  if (typeof val !== 'string') {
    addError(`'${field}' must be a string, got ${typeof val}`, path);
    return;
  }
  if (minLength !== undefined && val.length < minLength) {
    addError(`'${field}' too short: ${val.length} chars (min ${minLength})`, path);
  }
  if (maxLength !== undefined && val.length > maxLength) {
    addError(`'${field}' too long: ${val.length} chars (max ${maxLength})`, path);
  }
}

// ---------------------------------------------------------------------------
// Workflow-level validation (WorkflowCreate schema)
// ---------------------------------------------------------------------------

function validateWorkflow(wf) {
  log('Validating workflow top-level fields...');
  const p = 'workflow';

  // title — required, minLength 1, maxLength 200
  checkStringField(wf, 'title', p, { required: true, minLength: 1, maxLength: 200 });

  // id — optional, must be UUID format if present
  if (wf.id !== undefined && wf.id !== null) {
    if (typeof wf.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wf.id)) {
      addError(`'id' must be a valid UUID`, `${p}.id`);
    }
  }

  // description — optional string
  if (wf.description !== undefined && wf.description !== null && typeof wf.description !== 'string') {
    addError(`'description' must be a string`, `${p}.description`);
  }

  // isPrivate — optional boolean, default true
  if (wf.isPrivate !== undefined && typeof wf.isPrivate !== 'boolean') {
    addError(`'isPrivate' must be a boolean`, `${p}.isPrivate`);
  }

  // isDeployed — optional boolean, default true
  if (wf.isDeployed !== undefined && typeof wf.isDeployed !== 'boolean') {
    addError(`'isDeployed' must be a boolean`, `${p}.isDeployed`);
  }

  // schemaVersion — optional integer
  if (wf.schemaVersion !== undefined) {
    if (!Number.isInteger(wf.schemaVersion)) {
      addError(`'schemaVersion' must be an integer`, `${p}.schemaVersion`);
    }
  }

  // ownerType — optional enum
  if (wf.ownerType !== undefined && !VALID_OWNER_TYPES.includes(wf.ownerType)) {
    addError(`Invalid ownerType '${wf.ownerType}'. Must be: ${VALID_OWNER_TYPES.join(', ')}`, `${p}.ownerType`);
  }

  // owner — optional UUID string
  if (wf.owner !== undefined && wf.owner !== null) {
    if (typeof wf.owner !== 'string') {
      addError(`'owner' must be a UUID string`, `${p}.owner`);
    }
  }

  // actor — optional string, maxLength 36
  if (wf.actor !== undefined && wf.actor !== null) {
    if (typeof wf.actor !== 'string') {
      addError(`'actor' must be a string`, `${p}.actor`);
    } else if (wf.actor.length > 36) {
      addError(`'actor' too long: ${wf.actor.length} chars (max 36)`, `${p}.actor`);
    }
  }

  // type — optional enum
  if (wf.type !== undefined && !VALID_WORKFLOW_TYPES.includes(wf.type)) {
    addError(`Invalid workflow type '${wf.type}'. Must be: ${VALID_WORKFLOW_TYPES.join(', ')}`, `${p}.type`);
  }

  // hourlyExecutionLimit — optional integer, min 1, max 2147483647
  if (wf.hourlyExecutionLimit !== undefined && wf.hourlyExecutionLimit !== null) {
    if (!isIntInRange(wf.hourlyExecutionLimit, 1, 2147483647)) {
      addError(`'hourlyExecutionLimit' must be integer 1–2147483647`, `${p}.hourlyExecutionLimit`);
    }
  }

  // guide — optional string, maxLength 10000
  if (wf.guide !== undefined && wf.guide !== null) {
    checkStringField(wf, 'guide', p, { maxLength: 10000 });
  }

  // result — optional string (Jinja expression)
  if (wf.result !== undefined && wf.result !== null) {
    if (typeof wf.result !== 'string') {
      addError(`'result' must be a string`, `${p}.result`);
    } else {
      validateJinjaExpression(wf.result, `${p}.result`);
    }
  }

  // input — optional object
  if (wf.input !== undefined && wf.input !== null) {
    if (typeof wf.input !== 'object' || Array.isArray(wf.input)) {
      addError(`'input' must be an object`, `${p}.input`);
    }
  }

  // tasks — required per WorkflowCreate (title is only required field, but tasks is core)
  if (!wf.tasks) {
    addError('Missing required field: tasks', `${p}.tasks`);
  } else if (typeof wf.tasks !== 'object' || Array.isArray(wf.tasks)) {
    addError('tasks must be an object (map of task name → task definition)', `${p}.tasks`);
  } else {
    validateTasks(wf.tasks);
  }

  // trigger — optional
  if (wf.trigger !== undefined && wf.trigger !== null) {
    validateTrigger(wf.trigger);
  }
}

// ---------------------------------------------------------------------------
// Task validation (Task schema)
// ---------------------------------------------------------------------------

function validateTasks(tasks) {
  const taskNames = Object.keys(tasks);
  log(`Validating ${taskNames.length} task(s)...`);

  if (taskNames.length === 0) {
    addWarn('Workflow has no tasks defined', 'workflow.tasks');
    return;
  }

  for (const name of taskNames) {
    const task = tasks[name];
    const p = `tasks.${name}`;

    if (typeof task !== 'object' || task === null || Array.isArray(task)) {
      addError(`Task '${name}' must be an object`, p);
      continue;
    }

    // action — required, pattern ^.+:.+$
    if (!task.action) {
      addError(`Task '${name}': missing required field 'action'`, `${p}.action`);
    } else if (typeof task.action !== 'string') {
      addError(`Task '${name}': 'action' must be a string`, `${p}.action`);
    } else if (!ACTION_PATTERN.test(task.action)) {
      addError(
        `Task '${name}': invalid action format '${task.action}'. Must match <app.id>:<action-name> (pattern: ^.+:.+$)`,
        `${p}.action`,
      );
    }

    // name — optional string
    if (task.name !== undefined && task.name !== null && typeof task.name !== 'string') {
      addError(`Task '${name}': 'name' must be a string`, `${p}.name`);
    }

    // description — optional string
    if (task.description !== undefined && task.description !== null && typeof task.description !== 'string') {
      addError(`Task '${name}': 'description' must be a string`, `${p}.description`);
    }

    // active — optional boolean or string (Jinja)
    if (task.active !== undefined) {
      if (typeof task.active !== 'boolean' && typeof task.active !== 'string') {
        addError(`Task '${name}': 'active' must be boolean or string (Jinja expression)`, `${p}.active`);
      }
    }

    // position — optional { x: int, y: int }
    validateTaskPosition(task, name, p);

    // predecessors — optional array of unique strings
    validatePredecessors(task, name, taskNames, p);

    // conditions
    validateConditions(task, name, taskNames, p);

    // input — optional object; scan for Jinja expressions
    if (task.input !== undefined && task.input !== null) {
      if (typeof task.input !== 'object' || Array.isArray(task.input)) {
        addError(`Task '${name}': 'input' must be an object`, `${p}.input`);
      } else {
        scanForJinja(task.input, `${p}.input`);
      }
    }

    // withItems — optional string (Jinja expression)
    if (task.withItems !== undefined && task.withItems !== null) {
      if (typeof task.withItems !== 'string') {
        addError(`Task '${name}': 'withItems' must be a string`, `${p}.withItems`);
      } else {
        validateJinjaExpression(task.withItems, `${p}.withItems`);
      }
    }

    // concurrency — integer 1-99 or Jinja
    if (task.concurrency !== undefined) {
      if (typeof task.concurrency === 'string') {
        if (!isJinjaExpression(task.concurrency)) {
          addError(`Task '${name}': 'concurrency' string must be a Jinja expression ({{...}})`, `${p}.concurrency`);
        }
      } else if (!isIntInRange(task.concurrency, 1, 99)) {
        addError(`Task '${name}': 'concurrency' must be integer 1–99 or Jinja expression`, `${p}.concurrency`);
      }
    }

    // retry
    validateRetry(task, name, p);

    // timeout — integer 1-604800 or Jinja
    if (task.timeout !== undefined) {
      if (typeof task.timeout === 'string') {
        if (!isJinjaExpression(task.timeout)) {
          addError(`Task '${name}': 'timeout' string must be a Jinja expression ({{...}})`, `${p}.timeout`);
        }
      } else if (!isIntInRange(task.timeout, 1, 604800)) {
        addError(`Task '${name}': 'timeout' must be integer 1–604800 (seconds) or Jinja`, `${p}.timeout`);
      }
    }

    // waitBefore — integer 0-86400 or Jinja
    if (task.waitBefore !== undefined) {
      if (typeof task.waitBefore === 'string') {
        if (!isJinjaExpression(task.waitBefore)) {
          addError(`Task '${name}': 'waitBefore' string must be a Jinja expression`, `${p}.waitBefore`);
        }
      } else if (!isIntInRange(task.waitBefore, 0, 86400)) {
        addError(`Task '${name}': 'waitBefore' must be integer 0–86400 (seconds) or Jinja`, `${p}.waitBefore`);
      }
    }
  }

  // Cycle detection
  checkForCycles(tasks);
}

function validateTaskPosition(task, name, basePath) {
  if (task.position === undefined || task.position === null) {
    addWarn(`Task '${name}': missing 'position' (needed for UI layout)`, `${basePath}.position`);
    return;
  }

  const pos = task.position;
  const p = `${basePath}.position`;

  if (typeof pos !== 'object' || Array.isArray(pos)) {
    addError(`Task '${name}': 'position' must be an object {x, y}`, p);
    return;
  }

  // x: integer, min -1000, max 1000 (required per TaskPosition)
  if (pos.x === undefined) {
    addError(`Task '${name}': position missing required field 'x'`, `${p}.x`);
  } else if (!isIntInRange(pos.x, -1000, 1000)) {
    addError(`Task '${name}': position.x must be integer -1000 to 1000, got ${pos.x}`, `${p}.x`);
  }

  // y: integer, min 1, max 1000 (required per TaskPosition — y=0 is reserved for trigger)
  const yVal = pos.y;
  if (yVal === undefined) {
    addError(`Task '${name}': position missing required field 'y'`, `${p}.y`);
  } else if (!isIntInRange(yVal, 1, 1000)) {
    addError(`Task '${name}': position.y must be integer 1–1000 (y=0 is reserved for trigger), got ${yVal}`, `${p}.y`);
  }

  // Check if y was parsed as boolean true (YAML gotcha — unquoted y: becomes true)
  if (pos.y === undefined && pos.true !== undefined) {
    addError(
      `Task '${name}': 'y' key was parsed as boolean 'true' (YAML gotcha). Quote it: "y": ${pos.true}`,
      `${p}.y`,
    );
  }
}

function validatePredecessors(task, name, allTaskNames, basePath) {
  if (task.predecessors === undefined || task.predecessors === null) return;

  const p = `${basePath}.predecessors`;

  if (!Array.isArray(task.predecessors)) {
    addError(`Task '${name}': 'predecessors' must be an array`, p);
    return;
  }

  const seen = new Set();
  for (const pred of task.predecessors) {
    if (typeof pred !== 'string') {
      addError(`Task '${name}': predecessor entries must be strings`, p);
      continue;
    }
    if (!allTaskNames.includes(pred)) {
      addError(`Task '${name}': references non-existent predecessor '${pred}'`, p);
    }
    // uniqueItems: true
    if (seen.has(pred)) {
      addError(`Task '${name}': duplicate predecessor '${pred}' (must be unique)`, p);
    }
    seen.add(pred);
  }
}

function validateConditions(task, name, allTaskNames, basePath) {
  if (task.conditions === undefined || task.conditions === null) return;

  const cond = task.conditions;
  const p = `${basePath}.conditions`;

  if (typeof cond !== 'object' || Array.isArray(cond)) {
    addError(`Task '${name}': 'conditions' must be an object`, p);
    return;
  }

  // states — map of task name → state enum
  if (cond.states !== undefined && cond.states !== null) {
    if (typeof cond.states !== 'object' || Array.isArray(cond.states)) {
      addError(`Task '${name}': conditions.states must be an object`, `${p}.states`);
    } else {
      for (const [refTask, state] of Object.entries(cond.states)) {
        if (!allTaskNames.includes(refTask)) {
          addError(`Task '${name}': conditions.states references non-existent task '${refTask}'`, `${p}.states`);
        }
        if (typeof state === 'string' && !VALID_CONDITION_STATES.includes(state)) {
          addError(
            `Task '${name}': invalid condition state '${state}' for '${refTask}'. Must be: ${VALID_CONDITION_STATES.join(', ')}`,
            `${p}.states.${refTask}`,
          );
        }
      }
    }
  }

  // custom — optional string (Jinja expression)
  if (cond.custom !== undefined && cond.custom !== null && cond.custom !== '') {
    if (typeof cond.custom !== 'string') {
      addError(`Task '${name}': conditions.custom must be a string`, `${p}.custom`);
    } else {
      validateJinjaExpression(cond.custom, `${p}.custom`);
    }
  }

  // else — optional enum: SKIP or STOP
  if (cond.else !== undefined && cond.else !== null) {
    if (!VALID_ELSE_VALUES.includes(cond.else)) {
      addError(
        `Task '${name}': conditions.else must be '${VALID_ELSE_VALUES.join("' or '")}', got '${cond.else}'`,
        `${p}.else`,
      );
    }
  }
}

function validateRetry(task, name, basePath) {
  if (task.retry === undefined || task.retry === null) return;

  const retry = task.retry;
  const p = `${basePath}.retry`;

  if (typeof retry !== 'object' || Array.isArray(retry)) {
    addError(`Task '${name}': 'retry' must be an object`, p);
    return;
  }

  // count — required, integer 0-99 or Jinja
  if (retry.count === undefined) {
    addError(`Task '${name}': retry missing required field 'count'`, `${p}.count`);
  } else if (typeof retry.count === 'string') {
    if (!isJinjaExpression(retry.count)) {
      addError(`Task '${name}': retry.count string must be a Jinja expression`, `${p}.count`);
    }
  } else if (!isIntInRange(retry.count, 0, 99)) {
    addError(`Task '${name}': retry.count must be integer 0–99, got ${retry.count}`, `${p}.count`);
  }

  // delay — optional, integer 0-3600 or Jinja
  if (retry.delay !== undefined) {
    if (typeof retry.delay === 'string') {
      if (!isJinjaExpression(retry.delay)) {
        addError(`Task '${name}': retry.delay string must be a Jinja expression`, `${p}.delay`);
      }
    } else if (!isIntInRange(retry.delay, 0, 3600)) {
      addError(`Task '${name}': retry.delay must be integer 0–3600, got ${retry.delay}`, `${p}.delay`);
    }
  }

  // failedLoopIterationsOnly — optional boolean
  if (retry.failedLoopIterationsOnly !== undefined && typeof retry.failedLoopIterationsOnly !== 'boolean') {
    addError(`Task '${name}': retry.failedLoopIterationsOnly must be a boolean`, `${p}.failedLoopIterationsOnly`);
  }
}

// ---------------------------------------------------------------------------
// Trigger validation
// ---------------------------------------------------------------------------

function validateTrigger(trigger) {
  const p = 'trigger';
  log('Validating trigger...');

  if (typeof trigger !== 'object' || Array.isArray(trigger)) {
    addError('trigger must be an object', p);
    return;
  }

  // Empty trigger = manual/on-demand — valid
  if (Object.keys(trigger).length === 0) {
    log('Empty trigger (manual/on-demand) — OK');
    return;
  }

  if (trigger.schedule) validateScheduleTrigger(trigger.schedule);
  if (trigger.eventTrigger) validateEventTrigger(trigger.eventTrigger);

  // Cannot have both schedule and eventTrigger
  if (trigger.schedule && trigger.eventTrigger) {
    addWarn('Workflow has both schedule and eventTrigger — only one trigger type is typical', p);
  }
}

function validateScheduleTrigger(schedule) {
  const p = 'trigger.schedule';

  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    addError('trigger.schedule must be an object', p);
    return;
  }

  // isActive — optional boolean
  if (schedule.isActive !== undefined && typeof schedule.isActive !== 'boolean') {
    addError("schedule.isActive must be a boolean", `${p}.isActive`);
  }

  // trigger — required (ScheduleTrigger discriminated union)
  if (!schedule.trigger) {
    addError("schedule missing required field 'trigger'", p);
    return;
  }

  const trig = schedule.trigger;
  const tp = `${p}.trigger`;

  if (!trig.type) {
    addError("schedule.trigger missing required field 'type'", tp);
    return;
  }

  if (!VALID_SCHEDULE_TRIGGER_TYPES.includes(trig.type)) {
    addError(
      `Invalid schedule trigger type '${trig.type}'. Must be: ${VALID_SCHEDULE_TRIGGER_TYPES.join(', ')}`,
      `${tp}.type`,
    );
    return;
  }

  switch (trig.type) {
    case 'cron':
      if (!trig.cron || typeof trig.cron !== 'string') {
        addError("Cron trigger missing required field 'cron'", `${tp}.cron`);
      }
      break;

    case 'interval':
      if (trig.intervalMinutes === undefined) {
        addError("Interval trigger missing required field 'intervalMinutes'", `${tp}.intervalMinutes`);
      } else if (!isIntInRange(trig.intervalMinutes, 1, 720)) {
        addError(
          `intervalMinutes must be integer 1–720 (max 12 hours per spec), got ${trig.intervalMinutes}`,
          `${tp}.intervalMinutes`,
        );
      }
      // betweenStart / betweenEnd — optional, pattern HH:MM
      for (const field of ['betweenStart', 'betweenEnd']) {
        if (trig[field] !== undefined && trig[field] !== null) {
          if (typeof trig[field] !== 'string' || !BETWEEN_TIME_PATTERN.test(trig[field])) {
            addError(`${field} must match HH:MM format (e.g., "09:00"), got '${trig[field]}'`, `${tp}.${field}`);
          }
        }
      }
      break;

    case 'time':
      if (!trig.time || typeof trig.time !== 'string') {
        addError("Time trigger missing required field 'time'", `${tp}.time`);
      } else if (!TIME_PATTERN.test(trig.time)) {
        addError(
          `time must match HH:MM format (e.g., "09:00"), got '${trig.time}'`,
          `${tp}.time`,
        );
      }
      break;

    case 'once':
      if (!trig.at || typeof trig.at !== 'string') {
        addError("Once trigger missing required field 'at' (ISO 8601 without timezone)", `${tp}.at`);
      } else if (!ONCE_AT_PATTERN.test(trig.at)) {
        addError(
          `'at' must match YYYY-MM-DDTHH:MM:SS format (no timezone), got '${trig.at}'`,
          `${tp}.at`,
        );
      }
      // Warn about legacy 'dateTime' field
      if (trig.dateTime !== undefined) {
        addWarn(
          "Field 'dateTime' is not in the official spec. Use 'at' instead (format: YYYY-MM-DDTHH:MM:SS)",
          `${tp}.dateTime`,
        );
      }
      break;
  }

  // timezone lives on Schedule, not on the trigger sub-object
  if (schedule.timezone !== undefined && typeof schedule.timezone !== 'string') {
    addError("schedule.timezone must be a string (IANA timezone)", `${p}.timezone`);
  }
  if (trig.timezone !== undefined) {
    addWarn(
      "timezone should be on 'trigger.schedule' not inside 'trigger.schedule.trigger'. Per spec, timezone is a Schedule property.",
      `${tp}.timezone`,
    );
  }

  // filterParameters — optional object
  if (schedule.filterParameters !== undefined && schedule.filterParameters !== null) {
    validateScheduleFilterParameters(schedule.filterParameters, `${p}.filterParameters`);
  }
}

function validateScheduleFilterParameters(params, path) {
  if (typeof params !== 'object' || Array.isArray(params)) {
    addError('filterParameters must be an object', path);
    return;
  }
  if (params.count !== undefined && (!Number.isInteger(params.count) || params.count < 1)) {
    addError(`filterParameters.count must be a positive integer`, `${path}.count`);
  }
  if (params.earliestStartTime !== undefined && params.earliestStartTime !== null) {
    if (typeof params.earliestStartTime !== 'string' || !BETWEEN_TIME_PATTERN.test(params.earliestStartTime)) {
      addError(`filterParameters.earliestStartTime must match HH:MM`, `${path}.earliestStartTime`);
    }
  }
}

function validateEventTrigger(et) {
  const p = 'trigger.eventTrigger';

  if (typeof et !== 'object' || Array.isArray(et)) {
    addError('eventTrigger must be an object', p);
    return;
  }

  if (et.isActive !== undefined && typeof et.isActive !== 'boolean') {
    addError("eventTrigger.isActive must be a boolean", `${p}.isActive`);
  }

  if (!et.triggerConfiguration) {
    addWarn("eventTrigger missing 'triggerConfiguration'", p);
    return;
  }

  const tc = et.triggerConfiguration;
  const tp = `${p}.triggerConfiguration`;

  if (!tc.type) {
    addError("triggerConfiguration missing required field 'type'", tp);
    return;
  }

  if (!VALID_EVENT_TRIGGER_TYPES.includes(tc.type)) {
    addError(
      `Invalid event trigger type '${tc.type}'. Must be: ${VALID_EVENT_TRIGGER_TYPES.join(', ')}`,
      `${tp}.type`,
    );
    return;
  }

  if (!tc.value) {
    addError(`triggerConfiguration missing required field 'value'`, `${tp}.value`);
    return;
  }

  switch (tc.type) {
    case 'davis-event':
      validateDavisEventConfig(tc.value, `${tp}.value`);
      break;
    case 'davis-problem':
      validateDavisProblemConfig(tc.value, `${tp}.value`);
      break;
    case 'event':
      validateEventQueryConfig(tc.value, `${tp}.value`);
      break;
  }
}

function validateDavisEventConfig(val, path) {
  // entityTags — optional object
  if (val.entityTags !== undefined && val.entityTags !== null) {
    if (typeof val.entityTags !== 'object' || Array.isArray(val.entityTags)) {
      addError("entityTags must be an object", `${path}.entityTags`);
    }
  }

  // entityTagsMatch — optional enum or null
  if (val.entityTagsMatch !== undefined && val.entityTagsMatch !== null) {
    if (!VALID_ENTITY_TAGS_MATCH.includes(val.entityTagsMatch)) {
      addError(`entityTagsMatch must be '${VALID_ENTITY_TAGS_MATCH.join("' or '")}', got '${val.entityTagsMatch}'`, `${path}.entityTagsMatch`);
    }
  }

  // onProblemClose — optional boolean
  if (val.onProblemClose !== undefined && typeof val.onProblemClose !== 'boolean') {
    addError("onProblemClose must be a boolean", `${path}.onProblemClose`);
  }

  // maintenanceWindowTriggerBehavior
  if (val.maintenanceWindowTriggerBehavior !== undefined) {
    if (!VALID_MAINTENANCE_BEHAVIORS.includes(val.maintenanceWindowTriggerBehavior)) {
      addError(
        `maintenanceWindowTriggerBehavior must be 'always' or 'paused_while_in_window'`,
        `${path}.maintenanceWindowTriggerBehavior`,
      );
    }
  }

  // customFilter — optional string (DQL matcher, NOT full DQL)
  if (val.customFilter !== undefined && val.customFilter !== null) {
    if (typeof val.customFilter !== 'string') {
      addError("customFilter must be a string", `${path}.customFilter`);
    } else if (/^\s*fetch\s+/i.test(val.customFilter)) {
      addError(
        "customFilter must use DQL matcher expression, NOT full DQL. Remove 'fetch' keyword.",
        `${path}.customFilter`,
      );
    }
  }

  // names — optional array of {match, name}
  if (val.names !== undefined && val.names !== null) {
    if (!Array.isArray(val.names)) {
      addError("names must be an array", `${path}.names`);
    } else {
      for (let i = 0; i < val.names.length; i++) {
        const n = val.names[i];
        if (!n.match || !VALID_EVENT_NAME_MATCH.includes(n.match)) {
          addError(`names[${i}].match must be 'equals' or 'contains'`, `${path}.names[${i}].match`);
        }
        if (!n.name || typeof n.name !== 'string') {
          addError(`names[${i}].name is required and must be a string`, `${path}.names[${i}].name`);
        }
      }
    }
  }
}

function validateDavisProblemConfig(val, path) {
  // categories — required
  if (!val.categories) {
    addError("davis-problem trigger missing required field 'categories'", `${path}.categories`);
  } else if (typeof val.categories !== 'object' || Array.isArray(val.categories)) {
    addError("categories must be an object", `${path}.categories`);
  } else {
    for (const key of Object.keys(val.categories)) {
      if (!VALID_PROBLEM_CATEGORIES.includes(key)) {
        addWarn(`Unknown problem category '${key}'. Known: ${VALID_PROBLEM_CATEGORIES.join(', ')}`, `${path}.categories.${key}`);
      }
      if (typeof val.categories[key] !== 'boolean') {
        addError(`categories.${key} must be a boolean`, `${path}.categories.${key}`);
      }
    }
  }

  // entityTags, entityTagsMatch, onProblemClose, maintenanceWindowTriggerBehavior — same as davis-event
  if (val.entityTagsMatch !== undefined && val.entityTagsMatch !== null) {
    if (!VALID_ENTITY_TAGS_MATCH.includes(val.entityTagsMatch)) {
      addError(`entityTagsMatch must be '${VALID_ENTITY_TAGS_MATCH.join("' or '")}', got '${val.entityTagsMatch}'`, `${path}.entityTagsMatch`);
    }
  }
  if (val.onProblemClose !== undefined && typeof val.onProblemClose !== 'boolean') {
    addError("onProblemClose must be a boolean", `${path}.onProblemClose`);
  }
  if (val.maintenanceWindowTriggerBehavior !== undefined) {
    if (!VALID_MAINTENANCE_BEHAVIORS.includes(val.maintenanceWindowTriggerBehavior)) {
      addError(`maintenanceWindowTriggerBehavior must be 'always' or 'paused_while_in_window'`, `${path}.maintenanceWindowTriggerBehavior`);
    }
  }

  // analysisReady — optional boolean
  if (val.analysisReady !== undefined && typeof val.analysisReady !== 'boolean') {
    addError("analysisReady must be a boolean", `${path}.analysisReady`);
  }

  // severityThreshold — optional integer 1-5
  if (val.severityThreshold !== undefined && val.severityThreshold !== null) {
    if (!isIntInRange(val.severityThreshold, 1, 5)) {
      addError(`severityThreshold must be integer 1–5 (1=critical, 5=info), got ${val.severityThreshold}`, `${path}.severityThreshold`);
    }
  }

  // customFilter — optional string
  if (val.customFilter !== undefined && val.customFilter !== null && typeof val.customFilter !== 'string') {
    addError("customFilter must be a string", `${path}.customFilter`);
  }
}

function validateEventQueryConfig(val, path) {
  // query — required, string, minLength 1, maxLength 1000
  if (!val.query || typeof val.query !== 'string') {
    addError("event trigger missing required field 'query' (DQL matcher expression)", `${path}.query`);
  } else {
    if (val.query.trim().length === 0) {
      addError("event trigger 'query' must not be empty", `${path}.query`);
    }
    if (val.query.length > 1000) {
      addError(`event trigger query too long: ${val.query.length} chars (max 1000)`, `${path}.query`);
    }
    // Warn if it looks like full DQL (starts with 'fetch')
    if (/^\s*fetch\s+/i.test(val.query)) {
      addError(
        "Event trigger query must use DQL matcher expression, NOT full DQL. Do not use 'fetch' keyword.",
        `${path}.query`,
      );
    }
  }

  // eventType — optional enum
  if (val.eventType !== undefined) {
    if (!VALID_EVENT_TYPES.includes(val.eventType)) {
      addError(
        `Invalid eventType '${val.eventType}'. Must be: ${VALID_EVENT_TYPES.join(', ')}`,
        `${path}.eventType`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Jinja expression validation
// ---------------------------------------------------------------------------

function validateJinjaExpression(expr, path) {
  if (typeof expr !== 'string') return;

  // Check balanced {{ }}
  const openDouble = (expr.match(/\{\{/g) ?? []).length;
  const closeDouble = (expr.match(/\}\}/g) ?? []).length;
  if (openDouble !== closeDouble) {
    addError(`Unbalanced Jinja delimiters: ${openDouble} '{{' vs ${closeDouble} '}}'`, path);
  }

  // Check balanced {% %}
  const openBlock = (expr.match(/\{%/g) ?? []).length;
  const closeBlock = (expr.match(/%\}/g) ?? []).length;
  if (openBlock !== closeBlock) {
    addError(`Unbalanced Jinja block delimiters: ${openBlock} '{%' vs ${closeBlock} '%}'`, path);
  }

  // Check for known functions in {{ ... }} expressions
  // Use a regex that handles nested content better
  const exprBlocks = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < expr.length - 1; i++) {
    if (expr[i] === '{' && expr[i + 1] === '{') {
      if (depth === 0) start = i + 2;
      depth++;
      i++; // skip next char
    } else if (expr[i] === '}' && expr[i + 1] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        exprBlocks.push(expr.slice(start, i).trim());
        start = -1;
      }
      i++;
    }
  }

  for (const block of exprBlocks) {
    // Extract top-level function calls
    const funcMatch = block.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (funcMatch) {
      const func = funcMatch[1];
      if (!KNOWN_JINJA_FUNCTIONS.includes(func)) {
        // Not an error — could be a custom function or Jinja builtin
        addWarn(`Unknown workflow function '${func}()' — verify it exists in your environment`, path);
      }
    }
  }
}

/**
 * Recursively scan an object tree for string values containing Jinja,
 * and validate each one.
 */
function scanForJinja(obj, basePath) {
  if (typeof obj === 'string') {
    if (obj.includes('{{') || obj.includes('{%')) {
      validateJinjaExpression(obj, basePath);
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      scanForJinja(obj[i], `${basePath}[${i}]`);
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, val] of Object.entries(obj)) {
      scanForJinja(val, `${basePath}.${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Cycle detection (DFS on predecessor graph)
// ---------------------------------------------------------------------------

function checkForCycles(tasks) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  for (const name of Object.keys(tasks)) color[name] = WHITE;

  function dfs(node) {
    color[node] = GRAY;
    const preds = tasks[node]?.predecessors ?? [];
    for (const pred of preds) {
      if (color[pred] === undefined) continue; // non-existent task, already reported
      if (color[pred] === GRAY) {
        addError(`Circular dependency detected: '${node}' → '${pred}' forms a cycle`, `tasks.${node}.predecessors`);
        return true;
      }
      if (color[pred] === WHITE && dfs(pred)) return true;
    }
    color[node] = BLACK;
    return false;
  }

  for (const name of Object.keys(tasks)) {
    if (color[name] === WHITE) dfs(name);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Validating: ${filePath}\n`);

  const workflow = await parseFile(filePath);

  if (!workflow) {
    console.log('❌ Validation failed: Could not parse file');
    for (const e of errors) console.log(`  ERROR: ${e.message}`);
    process.exit(1);
  }

  validateWorkflow(workflow);

  // Summary
  console.log('─'.repeat(50));
  console.log(`Errors:   ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log('─'.repeat(50));

  if (errors.length > 0) {
    console.log('\n❌ ERRORS:');
    for (const e of errors) {
      console.log(`  • ${e.message}`);
      if (verbose && e.path) console.log(`    at ${e.path}`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:');
    for (const w of warnings) {
      console.log(`  • ${w.message}`);
      if (verbose && w.path) console.log(`    at ${w.path}`);
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n✅ Validation passed');
    process.exit(0);
  } else if (errors.length > 0 || (strict && warnings.length > 0)) {
    console.log('\n❌ Validation failed');
    process.exit(1);
  } else {
    console.log('\n✅ Validation passed with warnings');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e.message);
  process.exit(1);
});
