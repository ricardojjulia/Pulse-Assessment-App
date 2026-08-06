import React, { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { Skeleton, SkeletonText } from "@dynatrace/strato-components/content";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAssessmentHistory } from "./hooks/useAssessmentHistory";
import { useCoverageData } from "./hooks/useCoverageData";

const CoverageAssessment = React.lazy(() =>
  import("./pages/CoverageAssessment").then(m => ({ default: m.CoverageAssessment }))
);
const ComparisonPage = React.lazy(() =>
  import("./pages/ComparisonPage").then(m => ({ default: m.ComparisonPage }))
);
const TenantReviewApp = React.lazy(() =>
  import("./tenantReview/TenantReviewApp").then(m => ({ default: m.TenantReviewApp }))
);

export const App = () => {
  const history = useAssessmentHistory();
  const coverageData = useCoverageData();

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
              <Route path="/" element={<CoverageAssessment history={history} coverageData={coverageData} />} />
              <Route path="/compare" element={<ComparisonPage snapshots={history.snapshots} coverageData={coverageData} saveSnapshot={history.saveSnapshot} />} />
              <Route path="/tenant-review/*" element={<TenantReviewApp coverageData={coverageData} snapshots={history.snapshots} />} />
            </Routes>
          </Suspense>
        </Page.Main>
      </Page>
    </ErrorBoundary>
  );
};
