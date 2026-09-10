import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Menu } from "@dynatrace/strato-components-preview/navigation";
import type { ReportPersona, PersonaLang } from "../reports/personaReports";

export interface ReportActionsProps {
  exporting: boolean;
  onGeneratePersona: (persona: ReportPersona, lang: PersonaLang) => void;
  /** When provided the "Smart (Assist)…" item is shown. */
  onOpenSmartReport?: () => void;
  onOpenCustomReport: () => void;
  /** When provided the "Export Markdown" item is shown. */
  onMarkdownExport?: () => void;
}

/**
 * Reports dropdown button — used in both the idle state (IdleLeftPanel) and
 * the active-assessment toolbar. Shows Executive / Tactical / Technical PDF
 * exports plus optional Smart-report and Markdown-export items.
 */
export const ReportActions: React.FC<ReportActionsProps> = ({
  exporting,
  onGeneratePersona,
  onOpenSmartReport,
  onOpenCustomReport,
  onMarkdownExport,
}) => (
  <Menu>
    <Menu.Trigger>
      <Button loading={exporting} size="condensed">
        Reports
      </Button>
    </Menu.Trigger>
    <Menu.Content>
      {([
        ["executive", "Executive"],
        ["tactical", "Tactical"],
        ["technical", "Technical"],
      ] as [ReportPersona, string][]).map(([p, label]) => (
        <Menu.Sub key={p}>
          <Menu.SubTrigger>{label}</Menu.SubTrigger>
          <Menu.SubContent>
            <Menu.Item onSelect={() => onGeneratePersona(p, "en")}>English (EN)</Menu.Item>
            <Menu.Item onSelect={() => onGeneratePersona(p, "pt")}>Portugues (PT)</Menu.Item>
            <Menu.Item onSelect={() => onGeneratePersona(p, "es")}>Espanol (ES)</Menu.Item>
          </Menu.SubContent>
        </Menu.Sub>
      ))}
      {onOpenSmartReport && (
        <Menu.Item onSelect={onOpenSmartReport}>Smart (Assist)…</Menu.Item>
      )}
      <Menu.Item onSelect={onOpenCustomReport}>Custom…</Menu.Item>
      {onMarkdownExport && (
        <Menu.Item onSelect={onMarkdownExport}>Export Markdown</Menu.Item>
      )}
    </Menu.Content>
  </Menu>
);
