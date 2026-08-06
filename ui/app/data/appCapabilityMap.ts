// ui/app/data/appCapabilityMap.ts
//
// Which Dynatrace app serves which Pulse capability.
//
// The assessment measures whether the DATA is there. This map is the other
// half of the story: whether PEOPLE actually open the app that consumes
// that data. Adoption is reported alongside coverage — it never changes a
// score (see useAppAdoption.ts).
//
// Two layers, deliberately:
//   1. EXPLICIT — verified app ids observed on real tenants. Authoritative.
//   2. KEYWORD  — a fallback so an app we have not catalogued yet (a new
//      Dynatrace app, or a custom "my.*" app) still lands in a sensible
//      bucket instead of disappearing. Unmatched apps are reported under
//      "Other" rather than being silently dropped.

import { CAPABILITIES } from "../queries";

export const OTHER_BUCKET = "Other apps";

/** Verified app ids → capability name (must match CAPABILITIES names). */
const EXPLICIT: Record<string, string> = {
  // ── Infrastructure Observability ──
  "dynatrace.infraops": "Infrastructure Observability",
  "dynatrace.kubernetes": "Infrastructure Observability",
  "dynatrace.hosts": "Infrastructure Observability",
  "dynatrace.smartscape": "Infrastructure Observability",
  "dynatrace.clouds": "Infrastructure Observability",
  "dynatrace.extensions.manager": "Infrastructure Observability",
  "dynatrace.fleet.management": "Infrastructure Observability",
  "dynatrace.database.overview": "Infrastructure Observability",
  // ── Application Observability ──
  "dynatrace.services": "Application Observability",
  "dynatrace.distributedtracing": "Application Observability",
  "dynatrace.error.inspector": "Application Observability",
  "dynatrace.service.level.objectives": "Application Observability",
  // ── Digital Experience ──
  "dynatrace.experience.vitals": "Digital Experience",
  "dynatrace.users.sessions": "Digital Experience",
  "dynatrace.synthetic": "Digital Experience",
  "dynatrace.frontend.observability": "Digital Experience",
  "dynatrace.sessionreplay": "Digital Experience",
  // ── Log Analytics ──
  "dynatrace.logs": "Log Analytics",
  "dynatrace.notebooks": "Log Analytics",
  "dynatrace.openpipeline": "Log Analytics",
  "dynatrace.storage.management": "Log Analytics",
  // ── Application Security ──
  "dynatrace.security.vulnerabilities": "Application Security",
  "dynatrace.vulnerabilities": "Application Security",
  "dynatrace.security.posturemanagement": "Application Security",
  "dynatrace.codelevelvulnerabilities": "Application Security",
  // ── Threat Observability ──
  "dynatrace.davis.problems": "Threat Observability",
  "dynatrace.davis.anomalydetection": "Threat Observability",
  "dynatrace.security.investigator": "Threat Observability",
  "dynatrace.attacks": "Threat Observability",
  "dynatrace.threats": "Threat Observability",
  // ── AI Observability ──
  "dynatrace.genai.observability": "AI Observability",
  "dynatrace.ai.observability": "AI Observability",
  // ── Business Observability ──
  "dynatrace.biz.flow": "Business Observability",
  "dynatrace.biz.explore": "Business Observability",
  "dynatrace.biz.carbon": "Business Observability",
  "dynatrace.business.analytics": "Business Observability",
  // ── Software Delivery ──
  "dynatrace.automations": "Software Delivery",
  "dynatrace.sitereliabilityguardian": "Software Delivery",
  "dynatrace.releases": "Software Delivery",
  "dynatrace.dora": "Software Delivery",
  "dynatrace.pipeline.observability": "Software Delivery",
};

/** Fallback: first keyword found in the app id decides the bucket. Order
 *  matters — more specific terms first. */
const KEYWORDS: [string, string][] = [
  ["kubernetes", "Infrastructure Observability"],
  ["k8s", "Infrastructure Observability"],
  ["infra", "Infrastructure Observability"],
  ["host", "Infrastructure Observability"],
  ["cloud", "Infrastructure Observability"],
  ["rightsize", "Infrastructure Observability"],
  ["trace", "Application Observability"],
  ["service", "Application Observability"],
  ["vitals", "Digital Experience"],
  ["session", "Digital Experience"],
  ["synthetic", "Digital Experience"],
  ["journey", "Digital Experience"],
  ["rum", "Digital Experience"],
  ["frontend", "Digital Experience"],
  ["log", "Log Analytics"],
  ["pipeline.observability", "Software Delivery"],
  ["cicd", "Software Delivery"],
  ["automation", "Software Delivery"],
  ["release", "Software Delivery"],
  ["deploy", "Software Delivery"],
  ["vulnerab", "Application Security"],
  ["appsec", "Application Security"],
  ["security", "Threat Observability"],
  ["attack", "Threat Observability"],
  ["threat", "Threat Observability"],
  ["problem", "Threat Observability"],
  ["davis", "Threat Observability"],
  ["genai", "AI Observability"],
  ["ai.observability", "AI Observability"],
  ["llm", "AI Observability"],
  ["biz", "Business Observability"],
  ["business", "Business Observability"],
];

const CAP_NAMES = new Set(CAPABILITIES.map(c => c.name));

/** Resolve an app id to a capability, or OTHER_BUCKET when nothing fits. */
export function capabilityForApp(appId: string): string {
  const id = appId.toLowerCase();
  const explicit = EXPLICIT[id];
  if (explicit && CAP_NAMES.has(explicit)) return explicit;
  for (const [kw, cap] of KEYWORDS) {
    if (id.includes(kw) && CAP_NAMES.has(cap)) return cap;
  }
  return OTHER_BUCKET;
}

/** Human-friendly app name from its id ("dynatrace.davis.problems" →
 *  "Davis Problems"). Keeps report tables readable without a lookup call. */
export function prettyAppName(appId: string): string {
  return appId
    .replace(/^(dynatrace|my|community)\./, "")
    .split(".")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .replace(/\bApp\b$/, "")
    .trim();
}
