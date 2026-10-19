import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Locale } from "./domain";
import type { UnderwritingRun } from "./underwriting";
import { underwritingDocumentLines } from "./underwriting-document";

export async function underwritingPdf(
  run: UnderwritingRun,
  company: string,
  locale: Locale = "es",
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Curated Financial - Informe de análisis");
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
