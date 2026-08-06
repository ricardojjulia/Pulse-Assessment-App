import React, { useCallback, useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import type { Finding } from "../../types/review.types";

/** Generic section data for export */
export interface ExportSection {
  title: string;
  rows: { item: string; value: string; detail?: string }[];
}

/** Props for ExportButtons — accepts either findings or generic sections */
interface ExportButtonsProps {
  /** Page/report title used in the exported file */
  title: string;
  /** Findings-based data (review area pages) */
  findings?: Finding[];
  /** Section-based data (inventory, best practices) */
  sections?: ExportSection[];
  /** Optional summary lines added below the title */
  summary?: string[];
  /** Optional comprehensive Markdown export supplied by an aggregate report page */
  completeMarkdown?: { onExport: () => void; disabled?: boolean };
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Extract tenant ID from environment URL (e.g., "abc12345" from "https://abc12345.apps.dynatrace.com/") */
function getTenantId(): string {
  try {
    const url = getEnvironmentUrl();
    const match = url.match(/^https?:\/\/([^.]+)\./);
    return match?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const ExportButtons: React.FC<ExportButtonsProps> = ({ title, findings, sections, summary, completeMarkdown }) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const tenantId = useMemo(() => getTenantId(), []);
  const slug = slugify(title);

  const buildSections = useCallback((): ExportSection[] => {
    if (sections) return sections;
    if (findings) {
      return [{
        title: "Findings",
        rows: findings.map((f) => ({
          item: f.title,
          value: f.severity,
          detail: f.recommendation,
        })),
      }];
    }
    return [];
  }, [sections, findings]);

  const exportJson = useCallback(() => {
    const data = {
      title,
      tenant: tenantId,
      exportedAt: new Date().toISOString(),
      ...(summary ? { summary } : {}),
      sections: buildSections().map((sec) => ({
        title: sec.title,
        items: sec.rows.map((r) => ({
          item: r.item,
          value: r.value,
          ...(r.detail ? { detail: r.detail } : {}),
        })),
      })),
    };
    downloadFile(JSON.stringify(data, null, 2), `${tenantId}-${slug}-${dateStr}.json`, "application/json");
  }, [title, tenantId, summary, buildSections, slug, dateStr]);

  const exportMarkdown = useCallback(() => {
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const lines: string[] = [`# ${title}`, "", `> Tenant: \`${tenantId}\` | Exported: ${ts}`, ""];
    if (summary) {
      for (const line of summary) lines.push(line);
      lines.push("");
    }
    for (const sec of buildSections()) {
      lines.push(`## ${sec.title}`, "");
      lines.push("| Item | Value |", "|------|-------|");
      for (const row of sec.rows) {
        lines.push(`| ${row.item.replace(/\|/g, "\\|")} | ${row.value.replace(/\|/g, "\\|")} |`);
        if (row.detail) {
          lines.push(`| | _${row.detail.replace(/\|/g, "\\|")}_ |`);
        }
      }
      lines.push("");
    }
    downloadFile(lines.join("\n"), `${tenantId}-${slug}-${dateStr}.md`, "text/markdown");
  }, [title, tenantId, summary, buildSections, slug, dateStr]);

  return (
    <Flex gap={8}>
      {completeMarkdown && (
        <Button onClick={completeMarkdown.onExport} disabled={completeMarkdown.disabled} variant="emphasized" color="primary">
          Export All Markdown
        </Button>
      )}
      <Button onClick={exportJson} variant="default" color="neutral">
        Export JSON
      </Button>
      <Button onClick={exportMarkdown} variant="default" color="neutral">
        Export Markdown
      </Button>
    </Flex>
  );
};
