import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  referenceLenderTiers,
  referenceSpecialNotes,
} from "../lender-catalogue";
import type { Lender } from "../domain";
export async function lenderCataloguePdf(lenders: Lender[] = []) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Curated Financial - Lender tiers");
  const font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]),
    y = 735;
  const safe = (s: string) => s.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "?");
  function line(value: string, heading = false) {
    if (heading && y < 110) {
      page = pdf.addPage([612, 792]);
      y = 735;
    }
    const size = heading ? 13 : 10,
      selected = heading ? bold : font;
    let text = "";
    const flush = () => {
      if (y < 65) {
        page = pdf.addPage([612, 792]);
        y = 735;
      }
      page.drawText(text, {
        x: 48,
        y,
        font: selected,
        size,
        color: rgb(0.06, 0.2, 0.16),
      });
      y -= heading ? 25 : 16;
    };
    for (const word of safe(value).split(/\s+/)) {
      if (selected.widthOfTextAtSize(word, size) > 510) {
        if (text) {
          flush();
          text = "";
        }
        for (const character of word) {
          if (selected.widthOfTextAtSize(text + character, size) > 510) {
            flush();
            text = "";
          }
          text += character;
        }
        continue;
      }
      if (selected.widthOfTextAtSize(`${text} ${word}`, size) > 510 && text) {
        flush();
        text = word;
      } else text += `${text ? " " : ""}${word}`;
    }
    flush();
  }
  line("CURATED FINANCIAL", true);
  line("Lender tiers - Internal reference", true);
  line(
    "Source: underwriting instructions supplied by the CRM owner. This reference is not a confirmation of current lender policies or funding eligibility.",
  );
  y -= 12;
  for (const [tier, names] of Object.entries(referenceLenderTiers)) {
    line(tier === "reverse" ? "Reverse lenders" : `Tier ${tier}`, true);
    line(names.join(" / "));
    y -= 8;
  }
  line("Special notes", true);
  for (const note of referenceSpecialNotes) line(note);
  if (lenders.length) {
    page = pdf.addPage([612, 792]);
    y = 735;
    line("CRM directory - Saved guidelines", true);
    for (const lender of lenders.sort((a, b) => a.name.localeCompare(b.name))) {
      if (y < 150) {
        page = pdf.addPage([612, 792]);
        y = 735;
      }
      const g = lender.guidelines;
      line(lender.name, true);
      line(
        `Tier: ${g?.tier || "unknown"} | Version: ${lender.guideline_version || 0} | ${g?.verified ? "Confirmed by team" : "Unconfirmed"}`,
      );
      if (g) {
        line(
          `Source: ${g.source || "Not supplied"} | As of: ${g.as_of || "Not supplied"}`,
        );
        line(
          `Minimum credit: ${g.min_credit ?? "unknown"}; months in business: ${g.min_months_in_business ?? "unknown"}; maximum positions: ${g.max_positions ?? "unknown"}.`,
        );
        if (g.notes) line(g.notes);
      }
      y -= 10;
    }
  }
  pdf
    .getPages()
    .forEach((p, i) =>
      p.drawText(
        `Curated Financial | Internal reference | ${i + 1} / ${pdf.getPageCount()}`,
        { x: 48, y: 35, font, size: 9 },
      ),
    );
  return Buffer.from(await pdf.save());
}
