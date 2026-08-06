// ═══════════════════════════════════════════════════════════
// Criterion Tier Classification
//
// Each criterion is classified into one of three tiers:
//   - foundation:    Essential items everyone should have (~3-4 per capability)
//   - bestPractice:  Good practices for deeper adoption (~4-5 per capability)
//   - excellence:    Advanced/mature usage patterns (~2-3 per capability)
//
// Utilization levels per capability:
//   L0 (Not Adopted):  Foundation < 50%
//   L1 (Foundation):   Foundation ≥ 50%
//   L2 (Operational):  Foundation 100% + Best Practice ≥ 50%
//   L3 (Optimized):    Foundation 100% + Best Practice 100% + Excellence ≥ 50%
// ═══════════════════════════════════════════════════════════

export type CriterionTier = "foundation" | "bestPractice" | "excellence";

export const CRITERION_TIERS: Record<string, CriterionTier> = {
  // ─── 1. INFRASTRUCTURE OBSERVABILITY ───
  i1:  "foundation",     // Host CPU coverage
  i2:  "foundation",     // Host memory coverage
  i4:  "foundation",     // Host availability coverage
  i3:  "bestPractice",   // Host disk coverage
  i5:  "bestPractice",   // Host network coverage
  i6:  "bestPractice",   // Process CPU coverage
  i9:  "bestPractice",   // Davis problem coverage
  i7:  "excellence",     // K8s cluster coverage
  i8:  "excellence",     // Host disk entity coverage
  i10: "excellence",     // Cloud workload coverage
  i11: "bestPractice",   // Host-process topology
  i12: "excellence",     // K8s workload mapping
  // Cloud Platform Monitoring (under Infrastructure)
  i13: "bestPractice",   // Cloud host log enrichment
  i14: "bestPractice",   // Cloud log enrichment
  i15: "excellence",     // Cloud region diversity
  i16: "excellence",     // Cloud AZ diversity
  i17: "bestPractice",   // Cloud account monitoring
  i18: "excellence",     // Cloud span enrichment
  i19: "bestPractice",   // K8s node monitoring depth
  i20: "bestPractice",   // Cloud namespace metric coverage
  i21: "bestPractice",   // Container restart monitoring
  i22: "excellence",     // Container resource limits

  // ─── 2. APPLICATION OBSERVABILITY ───
  a1:  "foundation",     // Service tracing coverage
  a3:  "foundation",     // Root span coverage
  a5:  "foundation",     // Response time coverage
  a2:  "bestPractice",   // Service method coverage
  a6:  "bestPractice",   // Failure tracking coverage
  a7:  "bestPractice",   // Throughput coverage
  a4:  "excellence",     // OTel instrumentation coverage
  a8:  "excellence",     // Database span coverage
  a9:  "excellence",     // Messaging span coverage
  a10: "excellence",     // Multi-service trace depth
  a11: "bestPractice",   // Service-process mapping
  a12: "excellence",     // Service tagging utilization
  a13: "excellence",     // Database call depth
  a14: "foundation",     // Frontend trace correlation
  a15: "bestPractice",   // Route metadata coverage
  a16: "bestPractice",   // Exception trace coverage
  a17: "excellence",     // Release context coverage
  a18: "bestPractice",   // Trace-log correlation

  // ─── 3. DIGITAL EXPERIENCE ───
  d1:  "foundation",     // RUM action coverage
  d2:  "foundation",     // Session tracking coverage
  d3:  "foundation",     // LCP coverage
  d4:  "bestPractice",   // INP coverage
  d5:  "bestPractice",   // CLS coverage
  d6:  "bestPractice",   // Frontend error coverage
  d7:  "bestPractice",   // Synthetic HTTP coverage
  d8:  "excellence",     // Synthetic browser coverage
  d9:  "excellence",     // Mobile app coverage
  d10: "excellence",     // Synthetic location diversity
  d11: "bestPractice",   // Synthetic availability coverage
  d12: "foundation",     // Session replay coverage
  d13: "foundation",     // Navigation journey coverage
  d14: "bestPractice",   // Page/view summary coverage
  d15: "excellence",     // Mobile crash coverage

  // ─── 4. LOG ANALYTICS ───
  l1:  "foundation",     // Host log coverage
  l2:  "foundation",     // Service log coverage
  l6:  "foundation",     // Log source diversity
  l3:  "bestPractice",   // Trace-correlated logs
  l4:  "bestPractice",   // Entity-enriched logs
  l7:  "bestPractice",   // Error log coverage
  l9:  "bestPractice",   // Log severity diversity
  l5:  "excellence",     // Process group log correlation
  l8:  "excellence",     // K8s log coverage
  l10: "excellence",     // Log retention validation
  l11: "foundation",     // Dedicated buckets usage
  l12: "bestPractice",   // Structured logging
  l13: "excellence",     // Span-correlated logs
  l14: "bestPractice",   // Log volume balance
  l15: "excellence",     // Log-based events
  l16: "bestPractice",   // Custom attribute enrichment

  // ─── 5. APPLICATION SECURITY ───
  s1:  "foundation",     // Service security coverage
  s3:  "foundation",     // Runtime vulnerability baseline
  s4:  "foundation",     // Database interaction security
  s2:  "bestPractice",   // Security event type coverage
  s5:  "bestPractice",   // Error log security coverage
  s6:  "bestPractice",   // Warn log security coverage
  s7:  "excellence",     // Event kind diversity
  s8:  "excellence",     // Failed request coverage
  s9:  "excellence",     // Davis security problem coverage
  s10: "foundation",     // HTTP request surface coverage
  s11: "bestPractice",   // Attack detection coverage

  // ─── 6. THREAT OBSERVABILITY ───
  t1:  "foundation",     // Davis problem entity coverage
  t4:  "foundation",     // Security event service coverage
  t5:  "foundation",     // Error log threat coverage
  t2:  "bestPractice",   // Root cause analysis coverage
  t3:  "bestPractice",   // Problem category coverage
  t6:  "bestPractice",   // Log source threat coverage
  t7:  "bestPractice",   // Log entity enrichment
  t8:  "excellence",     // Trace-correlated threat logs
  t9:  "excellence",     // Recurring root cause detection
  t10: "excellence",     // Problem resolution coverage
  t11: "bestPractice",   // Event entity correlation

  // ─── 7. AI OBSERVABILITY ───
  ai1: "foundation",     // AI span service coverage
  ai2: "foundation",     // Token tracking coverage
  ai3: "bestPractice",   // AI provider diversity
  ai4: "bestPractice",   // Agent invocation coverage
  ai6: "foundation",     // AI status tracking coverage
  ai5: "excellence",     // Prompt/response tracing coverage
  ai7: "excellence",     // Guardrail coverage
  ai8: "excellence",     // Cost tracking coverage
  ai9: "excellence",     // AI tracing service breadth

  // ─── 8. BUSINESS OBSERVABILITY ───
  b1:  "foundation",     // Service bizevent coverage
  b2:  "foundation",     // Bizevent type diversity
  b3:  "foundation",     // Events with service context
  b4:  "bestPractice",   // Bizevent provider diversity
  b5:  "bestPractice",   // Revenue data coverage
  b6:  "excellence",     // Session-linked events
  b7:  "excellence",     // Trace-linked events
  b8:  "excellence",     // Cost center coverage

  // ─── 9. SOFTWARE DELIVERY ───
  sd1: "foundation",     // Service deployment coverage
  sd5: "foundation",     // Service request baseline
  sd7: "foundation",     // Process group coverage
  sd2: "bestPractice",   // Custom deployment coverage
  sd3: "bestPractice",   // Event kind diversity
  sd6: "bestPractice",   // Service failure baseline
  sd4: "excellence",     // Event type diversity
  sd8: "excellence",     // Davis problem detection
  sd9: "bestPractice",   // Process group tagging
  sd10: "excellence",    // Ownership assignment


};
