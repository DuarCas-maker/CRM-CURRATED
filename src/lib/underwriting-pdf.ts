import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Locale } from "./domain";
import type { UnderwritingRun } from "./underwriting";
import {
  underwritingDocumentLines,
  underwritingWarning,
} from "./underwriting-document";
import { compactReportBlocks } from "./underwriting-compact";

export async function underwritingPdf(
  run: UnderwritingRun,
  company: string,
  locale: Locale = "es",
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    locale === "es"
      ? "Curated Financial - Informe de análisis"
      : "Curated Financial - Underwriting report",
  );
  pdf.setAuthor("Curated Financial CRM");
  const regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.16, 0.15, 0.14),
    accent = rgb(0.55, 0.48, 0.4);
  let page = pdf.addPage([612, 792]),
    y = 714;
  function header() {
    page.drawText("CURATED FINANCIAL", {
      x: 48,
      y: 750,
      font: bold,
      size: 12,
      color: ink,
    });
    page.drawLine({
      start: { x: 48, y: 735 },
      end: { x: 564, y: 735 },
      thickness: 1,
      color: accent,
    });
  }
  function next() {
    page = pdf.addPage([612, 792]);
    y = 714;
    header();
  }
  header();
  const safe = (text: string) =>
    text.replace(/[−–—]/g, "-").replace(/[^\x20-\x7e\u00a0-\u00ff\n]/g, "?");
  if (run.report?.compact_report) {
    const wrap = (
      text: string,
      width: number,
      size: number,
      font = regular,
    ) => {
      const lines: string[] = [];
      for (const paragraph of safe(text).split("\n")) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          if (font.widthOfTextAtSize(word, size) > width) {
            if (line) {
              lines.push(line);
              line = "";
            }
            for (const ch of word) {
              if (font.widthOfTextAtSize(line + ch, size) > width) {
                lines.push(line);
                line = "";
              }
              line += ch;
            }
          } else if (
            line &&
            font.widthOfTextAtSize(line + " " + word, size) > width
          ) {
            lines.push(line);
            line = word;
          } else line += (line ? " " : "") + word;
        }
        lines.push(line);
      }
      return lines;
    };
    const paragraph = (text: string, heading = false) => {
      const font = heading ? bold : regular,
        size = heading ? 10.5 : 9;
      if (heading) {
        if (y < 110) next();
        y -= 7;
      }
      for (const line of wrap(text, 516, size, font)) {
        if (y < 65) next();
        page.drawText(line, { x: 48, y, font, size, color: ink });
        y -= 12;
      }
      y -= heading ? 3 : 5;
    };
    paragraph(company + " · UW", true);
    paragraph(
      `${run.model} | Prompt v${run.prompt_version} | ${new Date(run.created_at).toLocaleDateString(locale === "es" ? "es-CO" : "en-US", { timeZone: "America/Bogota" })}`,
    );
    paragraph(
      locale === "es"
        ? "Recomendación de IA para revisión humana. La decisión corresponde al usuario."
        : "AI recommendation for human review. The user makes the decision.",
    );
    if (run.status === "approved" || run.status === "rejected")
      paragraph(
        locale === "es"
          ? run.status === "approved"
            ? "Aprobado por el usuario"
            : "Descartado por el usuario"
          : run.status === "approved"
            ? "Approved by user"
            : "Discarded by user",
      );
    if (run.review_notes) paragraph(run.review_notes);
    for (const block of compactReportBlocks(
      run.report,
      locale,
      run.document_snapshot,
    )) {
      if (block.kind !== "table") {
        paragraph(
          (block.kind === "bullet" ? "- " : "") + block.text,
          block.kind === "heading",
        );
        continue;
      }
      const row = (cells: string[][], head = false) => {
        const height = Math.max(1, ...cells.map((c) => c.length)) * 11 + 8;
        if (head)
          page.drawRectangle({
            x: 48,
            y: y - height + 3,
            width: 516,
            height,
            color: rgb(0.94, 0.92, 0.88),
          });
        let x = 48;
        cells.forEach((lines, i) => {
          lines.forEach((line, n) =>
            page.drawText(line, {
              x: x + 4,
              y: y - 9 - n * 11,
              font: head ? bold : regular,
              size: head ? 7.5 : 8,
              color: ink,
            }),
          );
          x += block.widths[i];
        });
        y -= height;
        page.drawLine({
          start: { x: 48, y: y + 3 },
          end: { x: 564, y: y + 3 },
          thickness: 0.4,
          color: accent,
        });
      };
      const heads = block.headers.map((h, i) =>
        wrap(h, block.widths[i] - 8, 7.5, bold),
      );
      const tablePage = () => {
        next();
        row(heads, true);
      };
      if (y < 130) next();
      row(heads, true);
      for (const values of block.rows) {
        let cells = values.map((v, i) => wrap(v, block.widths[i] - 8, 8));
        let needed = Math.max(...cells.map((c) => c.length)) * 11 + 8;
        if (needed > y - 65 && needed < 600) tablePage();
        while (Math.max(...cells.map((c) => c.length)) > 0) {
          const capacity = Math.floor((y - 65 - 8) / 11);
          if (capacity < 1) {
            tablePage();
            continue;
          }
          row(cells.map((c) => c.slice(0, capacity)));
          cells = cells.map((c) => c.slice(capacity));
          if (cells.some((c) => c.length)) tablePage();
        }
      }
      y -= 7;
    }
    if (run.report.validation_warnings?.length) {
      paragraph(
        locale === "es" ? "Observaciones para revisión" : "Review observations",
        true,
      );
      for (const code of run.report.validation_warnings)
        paragraph("- " + underwritingWarning(code, locale));
    }
    pdf
      .getPages()
      .forEach((p, i) =>
        p.drawText(
          `Curated Financial | ${locale === "es" ? "Revisión humana" : "Human review"} | ${i + 1} / ${pdf.getPageCount()}`,
          { x: 48, y: 35, font: regular, size: 8, color: accent },
        ),
      );
    return pdf.save();
  }
  for (const entry of underwritingDocumentLines(run, company, locale)) {
    const font = entry.heading ? bold : regular,
      size = entry.heading ? 11 : 9.5;
    const x = 48 + Math.min(entry.depth, 3) * 10,
      width = 564 - x;
    if (entry.heading) {
      if (y < 110) next();
      y -= 8;
    }
    const draw = (text: string) => {
      if (y < 65) next();
      page.drawText(text, { x, y, font, size, color: ink });
      y -= 14;
    };
    for (const paragraph of safe(entry.text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        if (font.widthOfTextAtSize(word, size) > width) {
          if (line) {
            draw(line);
            line = "";
          }
          for (const ch of word) {
            if (font.widthOfTextAtSize(line + ch, size) > width) {
              draw(line);
              line = "";
            }
            line += ch;
          }
        } else if (
          line &&
          font.widthOfTextAtSize(line + " " + word, size) > width
        ) {
          draw(line);
          line = word;
        } else line += (line ? " " : "") + word;
      }
      draw(line);
    }
    y -= entry.heading ? 2 : 4;
  }
  for (const [i, p] of pdf.getPages().entries())
    p.drawText(
      `Curated Financial | ${locale === "es" ? "Revisión humana" : "Human review"} | ${i + 1} / ${pdf.getPageCount()}`,
      { x: 48, y: 35, font: regular, size: 8, color: accent },
    );
  return pdf.save();
}
