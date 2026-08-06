import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Skeleton, SkeletonText } from "@dynatrace/strato-components/content";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAssessmentHistory } from "./hooks/useAssessmentHistory";
import { useCoverageData } from "./hooks/useCoverageData";
import { useScaleTier } from "./hooks/useScaleTier";

const CoverageAssessment = React.lazy(() =>
  import("./pages/CoverageAssessment").then(m => ({ default: m.CoverageAssessment }))
);
const ComparisonPage = React.lazy(() =>
  import("./pages/ComparisonPage").then(m => ({ default: m.ComparisonPage }))
);
const TenantReviewApp = React.lazy(() =>
  import("./tenantReview/TenantReviewApp").then(m => ({ default: m.TenantReviewApp }))
);
const AiInsightsPage = React.lazy(() =>
  import("./pages/AiInsightsPage").then(m => ({ default: m.AiInsightsPage }))
);

export const App = () => {
  const history = useAssessmentHistory();
  // Live host-count detection drives the Scale Tier choice. See
  // ./scale-tier.ts for the contract.
  const scale = useScaleTier();
  // Dev mode gates SE-facing diagnostic controls (perf JSON download,
  // force-refresh). Active when ?dev=1 or localStorage.cca.dev is set.
  // In a customer tenant with neither, the diagnostic surface is hidden.
  // Thread the scale metadata into useCoverageData so the downloadable
  // perf report records exactly which tier was auto-detected vs forced.
  const coverageData = useCoverageData(scale.tier, {
    autoTier: scale.autoTier,
    manualOverride: scale.override,
    hostCount: scale.hostCount,
  });

  return (
    <ErrorBoundary>
      <Page>
        <Page.Main>
          <Suspense fallback={
            <Flex flexDirection="column" gap={16} style={{ padding: 32 }}>
              <Skeleton height={48} width="30%" />
              <Flex gap={16}>
                <Skeleton height={300} width="50%" />
                <Flex flexDirection="column" gap={8} style={{ flex: 1 }}>
                  <SkeletonText lines={3} />
                  <Skeleton height={120} />
                </Flex>
              </Flex>
            </Flex>
          }>
            <Routes>
              <Route path="/" element={<CoverageAssessment history={history} coverageData={coverageData} scale={scale} />} />
              <Route path="/compare" element={<ComparisonPage snapshots={history.snapshots} saveSnapshot={history.saveSnapshot} />} />
              <Route path="/ai-insights" element={<AiInsightsPage coverageData={coverageData} scale={scale} />} />
              <Route path="/tenant-review/*" element={<TenantReviewApp coverageData={coverageData} snapshots={history.snapshots} />} />
            </Routes>
          </Suspense>
        </Page.Main>
      </Page>
    </ErrorBoundary>
  );
};
