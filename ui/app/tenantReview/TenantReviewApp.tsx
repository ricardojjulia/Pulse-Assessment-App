import React from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { Home } from "./pages/Home";
import { Overview } from "./pages/Overview";
import { MonitoringConfig } from "./pages/MonitoringConfig";
import { SettingsFramework } from "./pages/SettingsFramework";
import { DataStorage } from "./pages/DataStorage";
import { Alerting } from "./pages/Alerting";
import { Dashboards } from "./pages/Dashboards";
import { Extensions } from "./pages/Extensions";
import { Automation } from "./pages/Automation";
import { TaggingOrg } from "./pages/TaggingOrg";
import { ApiAccess } from "./pages/ApiAccess";
import { Security } from "./pages/Security";
import { Synthetic } from "./pages/Synthetic";
import { RumSession } from "./pages/RumSession";
import { LogMonitoring } from "./pages/LogMonitoring";
import { Metrics } from "./pages/Metrics";
import { ReviewSettings } from "./pages/ReviewSettings";
import { TenantInventory } from "./pages/TenantInventory";
import { Utilization } from "./pages/Utilization";
import { BestPractices } from "./pages/BestPractices";
import { ReviewConfigProvider, useReviewConfig } from "./hooks/useReviewConfig";

const BestPracticesGuard: React.FC = () => {
  const { config } = useReviewConfig();
  if (!config.betaFeatures.showBestPractices) {
    return <Navigate to="." replace />;
  }
  return <BestPractices />;
};

export const TenantReviewApp: React.FC = () => {
  return (
    <ReviewConfigProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/inventory" element={<TenantInventory />} />
          <Route path="/adoption" element={<Overview />} />
          <Route path="/monitoring" element={<MonitoringConfig />} />
          <Route path="/settings" element={<SettingsFramework />} />
          <Route path="/storage" element={<DataStorage />} />
          <Route path="/alerting" element={<Alerting />} />
          <Route path="/dashboards" element={<Dashboards />} />
          <Route path="/extensions" element={<Extensions />} />
          <Route path="/automation" element={<Automation />} />
          <Route path="/tagging" element={<TaggingOrg />} />
          <Route path="/api-access" element={<ApiAccess />} />
          <Route path="/security" element={<Security />} />
          <Route path="/synthetic" element={<Synthetic />} />
          <Route path="/rum" element={<RumSession />} />
          <Route path="/logs" element={<LogMonitoring />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/best-practices" element={<BestPracticesGuard />} />
          <Route path="/utilization" element={<Utilization />} />
          <Route path="/review-settings" element={<ReviewSettings />} />
        </Routes>
      </AppShell>
    </ReviewConfigProvider>
  );
};
