// ui/app/components/CustomReportModal.tsx
//
// Dynamic report builder — the user composes a PDF on demand: free-text
// title, which capabilities to include, which sections, and the language.
// Generation stays 100% client-side (buildPersonaReport "custom" mode),
// so it works on any customer tenant without Davis.

import React, { useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Modal } from "@dynatrace/strato-components-preview/overlays";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { PersonaLang, ReportSectionId } from "../reports/personaReports";

export interface CustomReportRequest {
  title: string;
  sections: ReportSectionId[];
  /** Capability names to include (subset of the last run). */
  caps: string[];
  lang: PersonaLang;
}

interface CustomReportModalProps {
  open: boolean;
  onClose: () => void;
  capabilityNames: string[];
  onGenerate: (req: CustomReportRequest) => void;
  dk: boolean;
}

const SECTION_GROUPS: { group: string; items: { id: ReportSectionId; label: string }[] }[] = [
  {
    group: "Overview",
    items: [
      { id: "posture", label: "Posture & radar" },
      { id: "covVsUtilization", label: "Coverage vs Utilization chart" },
      { id: "tierPass", label: "Tier pass rates" },
      { id: "evolution", label: "Score evolution" },
      { id: "adoption", label: "Adoption — users per capability" },
    ],
  },
  {
    group: "Business",
    items: [
      { id: "strengths", label: "Strengths & exposures" },
      { id: "quickWins", label: "Quick wins" },
      { id: "nextStage", label: "Path to next stage" },
      { id: "nextQuarter", label: "Next-quarter focus" },
    ],
  },
  {
    group: "Plan",
    items: [
      { id: "gapLandscape", label: "Gap landscape" },
      { id: "impactByTeam", label: "Improvement potential by team" },
      { id: "plan", label: "Improvements by team" },
      { id: "board", label: "Capability board" },
      { id: "nextLevel", label: "Next-level unlocks" },
      { id: "cadence", label: "Operating cadence" },
    ],
  },
  {
    group: "Technical",
    items: [
      { id: "statusDist", label: "Status distribution" },
      { id: "techDetail", label: "Full check detail + DQL" },
      { id: "appendix", label: "Environment appendix" },
    ],
  },
];

const DEFAULT_SECTIONS: ReportSectionId[] = ["posture", "covVsUtilization", "quickWins", "nextStage"];

const LANGS: { id: PersonaLang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "pt", label: "Portugues" },
  { id: "es", label: "Espanol" },
];

export const CustomReportModal: React.FC<CustomReportModalProps> = ({ open, onClose, capabilityNames, onGenerate, dk }) => {
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<Set<ReportSectionId>>(new Set(DEFAULT_SECTIONS));
  const [excludedCaps, setExcludedCaps] = useState<Set<string>>(new Set());
  const [lang, setLang] = useState<PersonaLang>("en");

  const accent = Colors.Text.Primary.Default;
  const border = Colors.Border.Neutral.Default;
  const textSec = Colors.Text.Neutral.Subdued;

  const toggleSection = (id: ReportSectionId) => {
    setSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleCap = (name: string) => {
    setExcludedCaps(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const chip = (selected: boolean, label: string, onClick: () => void, key?: string) => (
    <Flex
      key={key ?? label}
      role="button" tabIndex={0} aria-pressed={selected}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClick(); } }}
      style={{
        padding: "3px 10px", borderRadius: 12, cursor: "pointer", fontSize: 12,
        border: `1px solid ${selected ? accent : border}`,
        color: selected ? accent : textSec,
        background: selected ? (dk ? "rgba(99,102,241,0.14)" : "rgba(99,102,241,0.08)") : "transparent",
        fontWeight: selected ? 700 : 500,
        userSelect: "none",
      }}
    >
      {label}
    </Flex>
  );

  const selectedCount = sections.size;
  const capsCount = capabilityNames.length - excludedCaps.size;

  return (
    <Modal show={open} onDismiss={onClose} title="Custom report" size="small">
      <Flex flexDirection="column" gap={12} style={{ minWidth: 520, maxWidth: 640 }}>
        <Flex flexDirection="column" gap={4}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>Report title (optional)</Text>
          <input
            value={title}
            placeholder="e.g. Observability Review - Q3 Steering Committee"
            onChange={e => setTitle(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
            onKeyPress={(e) => e.stopPropagation()}
            style={{
              padding: "8px 10px", borderRadius: 6, fontSize: 13,
              border: `1px solid ${border}`, outline: "none",
              background: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)",
              color: "inherit", fontFamily: "inherit",
            }}
          />
        </Flex>

        <Flex flexDirection="column" gap={6}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>Capabilities ({capsCount}/{capabilityNames.length})</Text>
          <Flex gap={6} flexWrap="wrap">
            {capabilityNames.map(name => chip(!excludedCaps.has(name), name, () => toggleCap(name), name))}
          </Flex>
        </Flex>

        {SECTION_GROUPS.map(g => (
          <Flex key={g.group} flexDirection="column" gap={6}>
            <Text style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: textSec }}>
              {g.group}
            </Text>
            <Flex gap={6} flexWrap="wrap">
              {g.items.map(it => chip(sections.has(it.id), it.label, () => toggleSection(it.id), it.id))}
            </Flex>
          </Flex>
        ))}

        <Flex flexDirection="column" gap={6}>
          <Text style={{ fontSize: 12, fontWeight: 600 }}>Language</Text>
          <Flex gap={6}>
            {LANGS.map(l => chip(lang === l.id, l.label, () => setLang(l.id), l.id))}
          </Flex>
        </Flex>

        {/* Manual footer row — Strato Modal has no Modal.Footer */}
        <Flex justifyContent="flex-end" gap={8} style={{ marginTop: 4 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="emphasized" color="primary"
            disabled={selectedCount === 0 || capsCount === 0}
            onClick={() => {
              onGenerate({
                title: title.trim(),
                sections: [...sections],
                caps: capabilityNames.filter(n => !excludedCaps.has(n)),
                lang,
              });
              onClose();
            }}
          >
            {selectedCount === 0 ? "Select at least 1 section" : `Generate PDF (${selectedCount} sections)`}
          </Button>
        </Flex>
      </Flex>
    </Modal>
  );
};
