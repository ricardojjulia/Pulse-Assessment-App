import React from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "@dynatrace/strato-components-preview/layouts";
import { AppHeader } from "@dynatrace/strato-components-preview/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { SettingIcon } from "@dynatrace/strato-icons";
import { Sidebar } from "./Sidebar";
import { APP_VERSION } from "../../constants/app";
import { tenantReviewPath } from "../../routes";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const navigate = useNavigate();

  return (
    <Page>
      <Page.Header>
        <AppHeader>
          <AppHeader.NavItems>
            <AppHeader.AppNavLink />
          </AppHeader.NavItems>
          <AppHeader.ActionItems>
            <Button onClick={() => { void navigate("/"); }} size="condensed">
              Atlas
            </Button>
            <AppHeader.ActionButton
              onClick={() => { void navigate(tenantReviewPath("/review-settings")); }}
              prefixIcon={<SettingIcon />}
            />
          </AppHeader.ActionItems>
        </AppHeader>
      </Page.Header>
      <Page.Main>
        <Flex
          style={{ height: "100%", overflow: "hidden" }}
        >
          <Flex
            flexDirection="column"
            justifyContent="space-between"
            style={{ height: "100%" }}
          >
            <Sidebar />
            <Flex
              justifyContent="center"
              style={{
                padding: "8px 12px",
                borderTop: "1px solid rgba(128,128,128,0.12)",
              }}
            >
              <span style={{ fontSize: "11px", opacity: 0.4 }}>v{APP_VERSION}</span>
            </Flex>
          </Flex>
          <Flex
            flexDirection="column"
            style={{
              flex: 1,
              overflow: "auto",
              padding: "20px 24px",
            }}
          >
            {children}
          </Flex>
        </Flex>
      </Page.Main>
    </Page>
  );
};
