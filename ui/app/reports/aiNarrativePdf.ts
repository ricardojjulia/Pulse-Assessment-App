// ui/app/reports/aiNarrativePdf.ts
//
// Renders a Davis CoPilot markdown answer into the app's dark PDF shell —
// the "Smart Report" artifact. Deliberately simple markdown support
// (headings, bullets, numbered lists, paragraphs; bold/italic markers are
// stripped) because the prompt instruction already requests plain markdown
// without code fences or emoji.
//
// Every page carries an AI-generated disclosure — a Smart Report is a
// draft to review, not an audited document.

import { jsPDF } from "jspdf";

export interface AiNarrativeMeta {
  title: string;
  tenant: string;
  date: string;
  coverage: number;
  utilization: number;
  /** The user request that produced this report — printed under the title. */
  ask: string;
}

const clean = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/≥/g, ">=").replace(/→/g, "->").replace(/≈/g, "~")
    .replace(/[""]/g, '"').replace(/·/g, "-").replace(/—/g, "-")
    .replace(/[^\x20-\x7E]/g, "");

/** Build without saving — lets tests/preview harnesses render offline. */
export function buildAiNarrativePdf(markdown: string, meta: AiNarrativeMeta): jsPDF {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, H = 297, M = 15, CW = W - 2 * M;
  let y = 0;

  const paintBg = () => { pdf.setFillColor(11, 11, 26); pdf.rect(0, 0, W, H, "F"); };
  const addTopBar = () => { pdf.setFillColor(55, 100, 220); pdf.rect(0, 0, W, 3, "F"); };
  const ensureSpace = (need: number) => {
    if (y + need > H - 18) { pdf.addPage(); paintBg(); addTopBar(); y = 20; }
  };

  // ── header ──
  paintBg(); addTopBar();
  pdf.setTextColor(55, 100, 220);
  pdf.setFontSize(7); pdf.setFont("helvetica", "bold");
  pdf.text("DYNATRACE PLATFORM - PULSE ASSESSMENT - SMART REPORT", W / 2, 12, { align: "center" });
  pdf.setTextColor(232, 232, 240);
  pdf.setFontSize(19); pdf.setFont("helvetica", "bold");
  const titleLines = pdf.splitTextToSize(clean(meta.title), CW);
  pdf.text(titleLines, W / 2, 23, { align: "center" });
  y = 23 + titleLines.length * 8;
  pdf.setFontSize(9); pdf.setFont("helvetica", "normal");
  pdf.setTextColor(140, 145, 180);
  pdf.text(`${meta.tenant}  -  ${meta.date}  -  Coverage ${meta.coverage}%  -  Utilization ${meta.utilization}/100`, W / 2, y, { align: "center" });
  y += 6;
  // The request that produced this report — provenance for the reader.
  pdf.setFontSize(7.5);
  pdf.setTextColor(120, 125, 160);
  const askLines = pdf.splitTextToSize(`"${clean(meta.ask)}"`, CW - 20);
  pdf.text(askLines, W / 2, y, { align: "center" });
  y += askLines.length * 3.6 + 8;

  // ── markdown body ──
  const sectionHeader = (title: string) => {
    ensureSpace(20);
    pdf.setFillColor(30, 45, 90);
    pdf.roundedRect(M, y - 4, CW, 10, 2, 2, "F");
    pdf.setFontSize(11); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(255, 255, 255);
    pdf.text(clean(title), M + 5, y + 2.8);
    y += 13;
  };
  const subHeader = (title: string) => {
    ensureSpace(10);
    pdf.setFontSize(9.5); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(140, 190, 255);
    pdf.text(clean(title), M, y);
    y += 5.5;
  };
  const paragraph = (text: string, indent = 0) => {
    pdf.setFontSize(8.5); pdf.setFont("helvetica", "normal");
    pdf.setTextColor(200, 205, 228);
    const lines = pdf.splitTextToSize(clean(text), CW - indent);
    for (const ln of lines) {
      ensureSpace(5);
      pdf.text(ln, M + indent, y);
      y += 4.3;
    }
    y += 1.6;
  };
  const bulletItem = (text: string) => {
    ensureSpace(6);
    pdf.setFillColor(55, 100, 220);
    pdf.circle(M + 1.5, y - 1.2, 0.9, "F");
    paragraph(text, 6);
  };

  const lines = markdown.split(/\r?\n/);
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length > 0) { paragraph(paraBuf.join(" ")); paraBuf = []; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed === "") { flushPara(); continue; }
    if (/^#{1,2}\s+/.test(trimmed)) { flushPara(); sectionHeader(trimmed.replace(/^#{1,2}\s+/, "")); continue; }
    if (/^#{3,6}\s+/.test(trimmed)) { flushPara(); subHeader(trimmed.replace(/^#{3,6}\s+/, "")); continue; }
    if (/^[-*+]\s+/.test(trimmed)) { flushPara(); bulletItem(trimmed.replace(/^[-*+]\s+/, "")); continue; }
    if (/^\d+[.)]\s+/.test(trimmed)) { flushPara(); bulletItem(trimmed); continue; }
    if (/^[-=_*]{3,}$/.test(trimmed)) { flushPara(); continue; }  // horizontal rules
    paraBuf.push(trimmed);
  }
  flushPara();

  // ── footer + AI disclosure on every page ──
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(6); pdf.setFont("helvetica", "normal");
    pdf.setTextColor(90, 95, 130);
    pdf.text(`Dynatrace Platform - Pulse Assessment  |  ${meta.tenant}  |  ${meta.date}`, M, H - 8);
    pdf.text(`Page ${i} / ${pages}`, W - M, H - 8, { align: "right" });
    pdf.setTextColor(200, 170, 90);
    pdf.text("Generated with Davis CoPilot - review before sharing.", W / 2, H - 8, { align: "center" });
  }

  return pdf;
}

/** Browser entry point: build and trigger the download. */
export function generateAiNarrativePdf(markdown: string, meta: AiNarrativeMeta): void {
  buildAiNarrativePdf(markdown, meta).save(`pulse-smart-report-${meta.tenant}-${meta.date || "latest"}.pdf`);
}
