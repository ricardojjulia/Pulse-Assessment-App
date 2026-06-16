import React, { useState, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { useReviewConfig } from "../../hooks/useReviewConfig";
import { HomeIcon } from "@dynatrace/strato-icons";
import { HostsIcon } from "@dynatrace/strato-icons";
import { SettingIcon } from "@dynatrace/strato-icons";
import { StorageIcon } from "@dynatrace/strato-icons";
import { NotificationActiveIcon } from "@dynatrace/strato-icons";
import { GridIcon } from "@dynatrace/strato-icons";
import { ExtensionsIcon } from "@dynatrace/strato-icons";
import { AutomationEngineIcon } from "@dynatrace/strato-icons";
import { TokenIcon } from "@dynatrace/strato-icons";
import { KeyIcon } from "@dynatrace/strato-icons";
import { SecurityIcon } from "@dynatrace/strato-icons";
import { SyntheticMonitoringSignetIcon } from "@dynatrace/strato-icons";
import { UserSessionsIcon } from "@dynatrace/strato-icons";
import { LogsIcon } from "@dynatrace/strato-icons";
import { ChartCollectionIcon } from "@dynatrace/strato-icons";
import { CheckmarkIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { INVENTORY_SECTIONS } from "../../pages/TenantInventory";
import { TENANT_REVIEW_BASE_PATH, tenantReviewPath } from "../../routes";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  children?: NavItem[];
}

/** Full navigation tree */
const NAV_TREE: NavItem[] = [
  { to: "/", label: "Home", icon: <HomeIcon /> },
  {
    to: "/inventory", label: "Inventory", icon: <StorageIcon />,
  },
  {
    to: "/adoption", label: "Gen3 Adoption", icon: <ChartCollectionIcon />,
    children: [
      { to: "/monitoring", label: "Monitoring", icon: <HostsIcon /> },
      { to: "/storage", label: "Data Storage", icon: <StorageIcon /> },
      { to: "/settings", label: "Settings", icon: <SettingIcon /> },
      { to: "/extensions", label: "Extensions", icon: <ExtensionsIcon /> },
      { to: "/tagging", label: "Tagging & Org", icon: <TokenIcon /> },
      { to: "/api-access", label: "API & Access", icon: <KeyIcon /> },
      { to: "/alerting", label: "Alerting", icon: <NotificationActiveIcon /> },
      { to: "/dashboards", label: "Dashboards", icon: <GridIcon /> },
      { to: "/logs", label: "Log Monitoring", icon: <LogsIcon /> },
      { to: "/metrics", label: "Metrics", icon: <ChartCollectionIcon /> },
      { to: "/synthetic", label: "Synthetic", icon: <SyntheticMonitoringSignetIcon /> },
      { to: "/rum", label: "RUM & Sessions", icon: <UserSessionsIcon /> },
      { to: "/automation", label: "Automation", icon: <AutomationEngineIcon /> },
      { to: "/security", label: "Security", icon: <SecurityIcon /> },
    ],
  },
  {
    to: "/best-practices", label: "Best Practices", icon: <CheckmarkIcon />,
  },
  {
    to: "/utilization", label: "Utilization", icon: <GridIcon />,
  },
];

/** Routes that belong to the adoption subtree */
const ADOPTION_CHILD_ROUTES = [
  "/monitoring", "/storage", "/settings", "/extensions", "/tagging",
  "/api-access", "/alerting", "/dashboards", "/logs", "/metrics",
  "/synthetic", "/rum", "/automation", "/security",
];

const SidebarLink: React.FC<{
  item: NavItem;
  depth: number;
  isActive: boolean;
  isParentOfActive: boolean;
}> = ({ item, depth, isActive, isParentOfActive }) => {
  const [hovered, setHovered] = useState(false);
  const indent = depth * 16;

  const baseStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: `6px 12px 6px ${12 + indent}px`,
    borderRadius: "6px",
    textDecoration: "none",
    color: "inherit",
    fontSize: depth === 0 ? "13px" : "12px",
    lineHeight: "20px",
    transition: "all 0.15s",
  };

  const activeStyle: React.CSSProperties = {
    ...baseStyle,
    backgroundColor: Colors.Background.Field.Primary.Emphasized,
    color: Colors.Text.Primary.Default,
    fontWeight: 700,
    boxShadow: "inset 3px 0 0 " + Colors.Border.Primary.Accent,
    borderRadius: "0 8px 8px 0",
  };

  const parentActiveStyle: React.CSSProperties = {
    ...baseStyle,
    backgroundColor: Colors.Background.Field.Neutral.Emphasized,
    fontWeight: 600,
    opacity: 1,
  };

  const inactiveStyle: React.CSSProperties = {
    ...baseStyle,
    opacity: depth > 0 ? 0.75 : 0.9,
  };

  const hoverStyle: React.CSSProperties = {
    ...baseStyle,
    backgroundColor: Colors.Background.Field.Neutral.Emphasized,
    opacity: 1,
  };

  const resolvedStyle = isActive
    ? activeStyle
    : hovered
    ? hoverStyle
    : isParentOfActive
    ? parentActiveStyle
    : inactiveStyle;

  return (
    <NavLink
      to={tenantReviewPath(item.to)}
      end={item.to === "/" || item.to === "/adoption"}
      style={() => resolvedStyle}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => { setHovered(false); }}
    >
      <span style={{ display: "flex", width: "16px", justifyContent: "center", flexShrink: 0 }}>
        {item.icon}
      </span>
      {item.label}
    </NavLink>
  );
};

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const currentPath = location.pathname.startsWith(TENANT_REVIEW_BASE_PATH)
    ? location.pathname.slice(TENANT_REVIEW_BASE_PATH.length) || "/"
    : location.pathname;
  const { config } = useReviewConfig();

  // Filter nav tree based on beta feature flags
  const filteredNavTree = useMemo(() => {
    return NAV_TREE.filter((item) => {
      if (item.to === "/best-practices" && !config.betaFeatures.showBestPractices) return false;
      return true;
    });
  }, [config.betaFeatures.showBestPractices]);

  // Determine which parent section is active
  const isInAdoption = currentPath === "/adoption" || ADOPTION_CHILD_ROUTES.includes(currentPath);

  return (
    <Flex
      flexDirection="column"
      gap={2}
      style={{
        width: "220px",
        minWidth: "220px",
        padding: "12px 8px",
        borderRight: `1px solid ${Colors.Border.Neutral.Default}`,
        overflowY: "auto",
        height: "100%",
      }}
    >
      {filteredNavTree.map((item) => {
        const isTopActive = currentPath === item.to;
        const isParentOfActive = item.children
          ? item.children.some((c) => currentPath === c.to)
          : false;
        const showChildren = item.children && (isTopActive || isParentOfActive);

        // Show inventory jump links when on /inventory
        const showInventoryLinks = item.to === "/inventory" && isTopActive;

        return (
          <React.Fragment key={item.to}>
            <SidebarLink
              item={item}
              depth={0}
              isActive={isTopActive}
              isParentOfActive={isParentOfActive}
            />
            {showInventoryLinks && (
              <Flex flexDirection="column" gap={0} style={{ marginTop: "2px", marginBottom: "4px" }}>
                <Text
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: Colors.Text.Neutral.Subdued,
                    padding: "4px 12px 2px 28px",
                    letterSpacing: "0.5px",
                  }}
                >
                  Sections
                </Text>
                {INVENTORY_SECTIONS.map((sec) =>
                  sec.isGroup ? (
                    <a
                      key={sec.id}
                      href={`#${sec.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById(sec.id);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      style={{
                        display: "block",
                        padding: "6px 12px 2px 28px",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: Colors.Text.Neutral.Subdued,
                        textDecoration: "none",
                        cursor: "pointer",
                      }}
                    >
                      {sec.label.replace(/──/g, "").trim()}
                    </a>
                  ) : (
                    <a
                      key={sec.id}
                      href={`#${sec.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        const el = document.getElementById(sec.id);
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "4px 12px 4px 36px",
                        borderRadius: "6px",
                        textDecoration: "none",
                        color: Colors.Text.Neutral.Subdued,
                        fontSize: "12px",
                        lineHeight: "18px",
                        transition: "background-color 0.15s",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = String(Colors.Background.Field.Neutral.Emphasized); }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                    >
                      {sec.label}
                    </a>
                  )
                )}
              </Flex>
            )}
            {showChildren && item.children && (
              <Flex flexDirection="column" gap={0} style={{ marginTop: "2px", marginBottom: "4px" }}>
                {/* Section divider */}
                <Text
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    color: Colors.Text.Neutral.Subdued,
                    padding: "4px 12px 2px 28px",
                    letterSpacing: "0.5px",
                  }}
                >
                  Review Areas
                </Text>
                {item.children.map((child) => (
                  <SidebarLink
                    key={child.to}
                    item={child}
                    depth={1}
                    isActive={currentPath === child.to}
                    isParentOfActive={false}
                  />
                ))}
              </Flex>
            )}
          </React.Fragment>
        );
      })}
    </Flex>
  );
};
