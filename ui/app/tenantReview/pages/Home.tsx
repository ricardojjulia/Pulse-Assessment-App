import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentTheme } from "@dynatrace/strato-components/core";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Grid, Container } from "@dynatrace/strato-components/layouts";
import { Text, Strong } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { APP_ICON } from "../../data/appIcon";
import { APP_VERSION } from "../constants/app";
import { tenantReviewPath } from "../routes";

interface NavCard {
  title: string;
  subtitle: string;
  description: string;
  route: string;
  color: string;
  count: number;
  detail: string;
}

const NAV_CARDS: NavCard[] = [
  {
    title: "Inventory",
    subtitle: "What's in this tenant?",
    description:
      "Complete census of everything deployed: hosts, services, agents, settings, buckets, workflows, dashboards, extensions, and more. Pure facts with no scoring or evaluation.",
    route: "/inventory",
    color: Colors.Charts.Categorical.Color01.Default,
    count: 14,
    detail: "Tenant census",
  },
  {
    title: "Gen3 Adoption",
    subtitle: "How far along is the migration?",
    description:
      "Evaluate Gen3 and Grail migration status across review areas. Identifies Gen2 technical debt and rewards Gen3 adoption with configurable weights and thresholds.",
    route: "/adoption",
    color: Colors.Charts.Categorical.Color03.Default,
    count: 14,
    detail: "Migration review",
  },
  {
    title: "Utilization",
    subtitle: "Is the investment paying off?",
    description:
      "Overall Effective Score across Signals & Trust, Automation, Foundation, and Engagement. Measures whether monitoring translates into action, reliability, and consumption.",
    route: "/utilization",
    color: Colors.Charts.Categorical.Color05.Default,
    count: 4,
    detail: "OES pillars",
  },
];

const TOTAL_REVIEW_AREAS = NAV_CARDS.reduce((sum, card) => sum + card.count, 0);

const ReviewCard: React.FC<{
  card: NavCard;
  bgSurface: string;
  bgSubtle: string;
  border: string;
  text: string;
  textSec: string;
  dk: boolean;
}> = ({ card, bgSurface, bgSubtle, border, text, textSec, dk }) => {
  const navigate = useNavigate();

  return (
    <Flex
      flexDirection="column"
      onClick={() => {
        void navigate(tenantReviewPath(card.route));
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `0 4px 16px ${card.color}25`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
      style={{
        minHeight: 188,
        background: bgSurface,
        border: `1px solid ${border}`,
        borderLeft: `4px solid ${card.color}`,
        borderRadius: 12,
        padding: "20px 24px",
        cursor: "pointer",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
    >
      <Flex alignItems="center" gap={8} style={{ marginBottom: 18 }}>
        <Text
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: card.color,
            flexShrink: 0,
          }}
        />
        <Text style={{ fontSize: 14, fontWeight: 800, color: text, flex: 1 }}>
          {card.title}
        </Text>
        <Flex alignItems="center" gap={6}>
          <Text
            style={{
              fontSize: 12,
              color: textSec,
              fontWeight: 800,
              background: bgSubtle,
              padding: "3px 12px",
              borderRadius: 10,
            }}
          >
            {card.count}
          </Text>
          <Text
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: card.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 13,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            ✓
          </Text>
        </Flex>
      </Flex>

      <Flex flexDirection="column" gap={8} style={{ marginLeft: 24, flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: 700, color: textSec }}>
          {card.subtitle}
        </Text>
        <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.7 }}>
          {card.description}
        </Text>
      </Flex>

      <Flex
        justifyContent="space-between"
        alignItems="center"
        style={{
          marginTop: 14,
          marginLeft: 24,
          fontSize: 12,
          color: textSec,
          fontWeight: 700,
          opacity: dk ? 0.72 : 0.62,
        }}
      >
        <Text>{card.detail}</Text>
        <Text>Open section →</Text>
      </Flex>
    </Flex>
  );
};

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const dk = useCurrentTheme() === "dark";
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const colors = useMemo(
    () => ({
      bg: Colors.Background.Base.Default,
      bgSurface: Colors.Background.Surface.Default,
      bgSubtle: Colors.Background.Container.Neutral.Subdued,
      bgPrimary: Colors.Background.Container.Primary.Default,
      text: Colors.Text.Neutral.Default,
      textSec: Colors.Text.Neutral.Subdued,
      textTert: Colors.Text.Neutral.Disabled,
      accent: Colors.Text.Primary.Default,
      border: Colors.Border.Neutral.Default,
      borderPri: Colors.Border.Primary.Default,
    }),
    [],
  );

  const { bg, bgSurface, bgSubtle, bgPrimary, text, textSec, textTert, accent, border, borderPri } = colors;

  return (
    <Grid
      gridTemplateColumns="minmax(320px, 380px) minmax(0, 1fr)"
      gridTemplateRows="minmax(0, 1fr)"
      style={{
        minHeight: "calc(100vh - 96px)",
        margin: "-20px -24px",
        overflow: "hidden",
        background: bg,
        color: text,
      }}
    >
      <Flex
        flexDirection="column"
        alignItems="center"
        gap={20}
        style={{
          textAlign: "center",
          padding: "34px 20px 24px",
          overflowY: "auto",
          background: bgSubtle,
          borderRight: `1px solid ${border}`,
        }}
      >
        <Flex flexDirection="column">
          <Flex
            flexDirection="column"
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: accent,
              marginBottom: 14,
              opacity: 0.8,
            }}
          >
            Dynatrace Platform
          </Flex>
          <Flex alignItems="center" justifyContent="center" gap={8}>
            <img src={APP_ICON} alt="" width={38} height={38} style={{ borderRadius: 8 }} />
            <Flex
              flexDirection="column"
              style={{
                fontSize: 20,
                fontWeight: 900,
                color: text,
                lineHeight: 1.2,
              }}
            >
              Atlas
            </Flex>
          </Flex>
        </Flex>

        <Flex flexDirection="column" gap={8} style={{ width: "100%", maxWidth: 280 }}>
          <Button onClick={() => navigate("/")} variant="emphasized" color="primary" style={{ width: "100%", textAlign: "center" }}>
            DT Capability Assessment
          </Button>
          <Button onClick={() => navigate(tenantReviewPath("/app-rubrics"))} color="primary" variant="emphasized" style={{ width: "100%", textAlign: "center" }}>
            DT Inventory
          </Button>
          <Button onClick={() => navigate("/observability")} color="primary" variant="emphasized" style={{ width: "100%", textAlign: "center" }}>
            DT Observability Evaluation
          </Button>
        </Flex>

        <Flex gap={12}>
          {[
            { value: String(NAV_CARDS.length), label: "Sections", color: accent },
            { value: String(TOTAL_REVIEW_AREAS), label: "Review Areas", color: Colors.Text.Success.Default },
          ].map((kpi) => (
            <Flex
              key={kpi.label}
              flexDirection="column"
              style={{
                textAlign: "center",
                padding: "12px 18px",
                borderRadius: 10,
                background: kpi.color + (dk ? "15" : "10"),
                border: `1px solid ${kpi.color}30`,
              }}
            >
              <Text style={{ fontSize: 32, fontWeight: 900, color: kpi.color, lineHeight: 1 }}>
                {kpi.value}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: text,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginTop: 4,
                }}
              >
                {kpi.label}
              </Text>
            </Flex>
          ))}
        </Flex>

        <Flex flexDirection="column" style={{ fontSize: 12, color: textSec, lineHeight: 1.7, maxWidth: 320, textAlign: "left" }}>
          <button
            type="button"
            onClick={() => setShowHowItWorks((value) => !value)}
            aria-expanded={showHowItWorks}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${borderPri}`,
              background: bgPrimary,
              color: accent,
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            How it works
            <span
              style={{
                fontSize: 10,
                transform: showHowItWorks ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.16s",
              }}
            >
              ▼
            </span>
          </button>
          {showHowItWorks && (
            <Flex flexDirection="column" style={{ marginTop: 10 }}>
              <Flex gap={8} style={{ marginBottom: 8 }}>
                <Text style={{ color: accent, fontWeight: 900, fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>
                  1.
                </Text>
                <Text>
                  Open <Strong style={{ color: text }}>Inventory</Strong> for raw tenant facts before scoring.
                </Text>
              </Flex>
              <Flex gap={8} style={{ marginBottom: 8 }}>
                <Text style={{ color: accent, fontWeight: 900, fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>
                  2.
                </Text>
                <Text>
                  Use <Strong style={{ color: text }}>Gen3 Adoption</Strong> to evaluate migration status and technical debt.
                </Text>
              </Flex>
              <Flex gap={8}>
                <Text style={{ color: accent, fontWeight: 900, fontSize: 14, lineHeight: 1.3, flexShrink: 0 }}>
                  3.
                </Text>
                <Text>
                  Use <Strong style={{ color: text }}>Utilization</Strong> to calculate OES and prioritize ROI actions.
                </Text>
              </Flex>
            </Flex>
          )}
          <Text style={{ marginTop: 16, fontSize: 11, color: textTert }}>v{APP_VERSION}</Text>
        </Flex>
      </Flex>

      <Flex flexDirection="column" style={{ overflowY: "auto", padding: "20px 24px", minHeight: 0 }}>
        <Container color="primary" variant="default" style={{ marginBottom: 16 }}>
          <Flex alignItems="center" justifyContent="space-between" style={{ marginBottom: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: 800, color: text }}>
              {NAV_CARDS.length} Review Sections Available
            </Text>
            <Text style={{ fontSize: 11, fontWeight: 700, color: Colors.Text.Success.Default }}>
              ✓ Ready to Explore
            </Text>
          </Flex>
          <Text style={{ fontSize: 12, color: textSec, lineHeight: 1.6 }}>
            Click a card to open the tenant evaluator section. Inventory shows facts, Gen3 Adoption scores the migration,
            and Utilization calculates the Overall Effective Score from live tenant evidence.
          </Text>
        </Container>

        <Grid gridTemplateColumns="repeat(auto-fill, minmax(340px, 1fr))" gap={16}>
          {NAV_CARDS.map((card) => (
            <ReviewCard
              key={card.title}
              card={card}
              bgSurface={bgSurface}
              bgSubtle={bgSubtle}
              border={border}
              text={text}
              textSec={textSec}
              dk={dk}
            />
          ))}
        </Grid>
      </Flex>
    </Grid>
  );
};
