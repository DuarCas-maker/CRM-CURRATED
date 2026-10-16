import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CompanyApplicationRecord } from "../company-application";
export async function companyApplicationPdf(
  record: CompanyApplicationRecord,
  options: {
    id: string;
    revision: number;
    generatedAt?: string;
    declaration: string;
    files: { name: string; kind: string }[];
  },
) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle("Curated Financial Funding Application");
  const generatedAt = new Date(
    options.generatedAt ||
      record.signature?.signed_at ||
      "2026-01-01T00:00:00Z",
  );
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);
  let page = pdf.addPage([612, 792]),
    y = 745;
  const safe = (value: string) =>
    Array.from(value.replace(/[\r\n\t]/g, " "))
      .map((c) => {
        try {
          font.encodeText(c);
          return c;
        } catch {
          throw new Error("PDF_FONT_UNSUPPORTED_CHARACTER");
        }
      })
      .join("");
  const line = (value: string, heading = false) => {
    const size = heading ? 12 : 10;
    let current = "";
    const flush = () => {
      if (y < 55) {
        page = pdf.addPage([612, 792]);
        y = 745;
      }
      page.drawText(current, {
        x: 45,
        y,
        size,
        font: heading ? bold : font,
        color: rgb(0.08, 0.08, 0.08),
      });
      y -= heading ? 24 : 16;
    };
    const words = safe(value)
      .split(/\s+/)
      .flatMap((word) => {
        const chunks: string[] = [];
        let chunk = "";
        for (const char of word) {
          if (chunk && font.widthOfTextAtSize(chunk + char, size) > 520) {
            chunks.push(chunk);
            chunk = char;
          } else chunk += char;
        }
        if (chunk) chunks.push(chunk);
        return chunks;
      });
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > 520 && current) {
        flush();
        current = word;
      } else current = next;
    }
    flush();
  };
  line("curated Funding Application", true);
  line(`Application ID: ${options.id} | Revision: ${options.revision}`);
  line(
    record.signature
      ? "Status: Signed by authorized representative"
      : "Status: Unsigned draft",
  );
  y -= 8;
  const d = record.data;
  line("Business Information", true);
  for (const [label, value] of [
    ["Legal Company Name", d.legal_name],
    ["Entity Type", d.entity_type],
    ["Federal Tax ID / EIN", d.ein],
    ["State of Incorporation", d.incorporation_state],
    ["Business Inception Date", d.inception_date],
    ["Business Address", d.business_address],
    ["City", d.business_city],
    ["State", d.business_state],
    ["ZIP Code", d.business_zip],
  ])
    line(`${label}: ${value}`);
  d.owners.forEach((o, i) => {
    y -= 12;
    line(i ? "Second Owner Information" : "Owner Information", true);
    for (const [label, value] of [
      ["Owner Name", o.name],
      ["Email", o.email],
      ["SSN", o.ssn],
      ["Date of Birth", o.date_of_birth],
      ["Cell Phone", o.phone],
      ["Owner Address", o.address],
      ["City", o.city],
      ["State", o.state],
      ["ZIP Code", o.zip],
      ["Ownership Percentage", `${o.ownership}%`],
    ])
      line(`${label}: ${value}`);
  });
  line(`Second Owner: ${d.owners.length > 1 ? "Yes" : "No"}`);
  y -= 12;
  line("Commercial Information", true);
  line(`Commercial name: ${d.commercial_name}`);
  line(`Commercial Email: ${d.commercial_email}`);
  line(`Identifier: ${d.identifier}`);
  page = pdf.addPage([612, 792]);
  y = 745;
  line("Uploaded Documents", true);
  options.files.forEach((f) => line(`${f.name} (${f.kind})`));
  y -= 14;
  line("Disclosures & Authorization", true);
  line(record.declaration || options.declaration);
  if (y < 210) {
    page = pdf.addPage([612, 792]);
    y = 745;
  }
  y -= 14;
  line("Signature", true);
  if (record.signature) {
    const s = record.signature;
    const image = await pdf.embedPng(s.image);
    const dimensions = image.scaleToFit(260, 80);
    page.drawImage(image, {
      x: 45,
      y: y - dimensions.height,
      width: dimensions.width,
      height: dimensions.height,
    });
    y -= dimensions.height + 20;
    line(`Signed by: ${s.name}`);
    line(`Capacity: Authorized representative of ${d.legal_name}`);
    line(`Signed at: ${s.signed_at}`);
    line("Representative confirmed authorization to sign.");
  } else line("Unsigned - signature required before submission.");
  return pdf.save();
}
