import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import {
  applicationFilename,
  type CompanyApplicationRecord,
} from "../company-application";

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
  pdf.setTitle(applicationFilename(record.data).replace(/\.pdf$/i, ""));
  pdf.setProducer("Curated Financial Application");
  pdf.setAuthor("Curated Financial");
  const generatedAt = new Date(
    options.generatedAt ||
      record.signature?.signed_at ||
      "2026-01-01T00:00:00Z",
  );
  pdf.setCreationDate(generatedAt);
  pdf.setModificationDate(generatedAt);
  const ink = rgb(0.12, 0.15, 0.17),
    muted = rgb(0.38, 0.4, 0.42),
    rule = rgb(0.83, 0.83, 0.81),
    wash = rgb(0.96, 0.95, 0.93);
  let page = pdf.addPage([612, 792]),
    y = 746;
  const safe = (text: string) => {
    const result = text.replace(/[\r\n\t]/g, " ");
    try {
      font.encodeText(result);
    } catch {
      throw new Error("PDF_FONT_UNSUPPORTED_CHARACTER");
    }
    return result;
  };
  function wrap(
    value: string,
    width: number,
    size = 9.5,
    face: PDFFont = font,
  ) {
    const lines: string[] = [];
    let current = "";
    for (const word of safe(value).split(/\s+/)) {
      if (!word) continue;
      const candidate = current ? `${current} ${word}` : word;
      if (face.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      for (const c of word) {
        if (face.widthOfTextAtSize(current + c, size) > width) {
          lines.push(current);
          current = "";
        }
        current += c;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : ["-"];
  }
  function text(
    value: string,
    x: number,
    baseline: number,
    size = 9.5,
    face = font,
    color = ink,
  ) {
    page.drawText(safe(value), { x, y: baseline, size, font: face, color });
  }
  function newPage() {
    page = pdf.addPage([612, 792]);
    y = 746;
    text("CURATED FINANCIAL", 44, y, 9, bold, muted);
    text("Funding Application", 370, y, 10, bold);
    y -= 27;
  }
  function ensure(height: number) {
    if (y - height < 52) newPage();
  }
  function section(title: string) {
    ensure(78);
    y -= 10;
    page.drawRectangle({
      x: 44,
      y: y - 25,
      width: 524,
      height: 25,
      color: wash,
    });
    text(title, 54, y - 17, 11, bold);
    y -= 25;
  }
  function row(label: string, value: string) {
    const left = wrap(label, 170, 9, bold),
      right = wrap(value || "-", 316),
      height = Math.max(left.length, right.length) * 13 + 13;
    ensure(height);
    left.forEach((line, i) => text(line, 54, y - 16 - i * 13, 9, bold));
    right.forEach((line, i) => text(line, 242, y - 16 - i * 13));
    page.drawLine({
      start: { x: 44, y: y - height },
      end: { x: 568, y: y - height },
      thickness: 0.5,
      color: rule,
    });
    y -= height;
  }
  function paragraph(value: string) {
    for (const p of value.split(/\n\s*\n/)) {
      for (const line of wrap(p, 504, 9.5)) {
        ensure(15);
        text(line, 54, y - 13);
        y -= 14;
      }
      y -= 8;
    }
  }
  const date = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`
      : value;
  const address = (street: string, city: string, state: string, zip: string) =>
    [street, [city, state].filter(Boolean).join(", "), zip]
      .filter(Boolean)
      .join(" ");
  text("curated", 44, y, 27, bold);
  text("FINANCIAL", 45, y - 17, 8, bold, muted);
  text("Funding Application", 306, y, 20, bold);
  y -= 43;
  text(
    `Application ${options.id.slice(0, 8).toUpperCase()}  |  Revision ${options.revision}`,
    44,
    y,
    9,
    font,
    muted,
  );
  text(
    `Generated ${generatedAt.toISOString().slice(0, 10)}`,
    410,
    y,
    9,
    font,
    muted,
  );
  y -= 19;
  text(
    record.signature ? "SIGNED BY AUTHORIZED REPRESENTATIVE" : "UNSIGNED DRAFT",
    44,
    y,
    9,
    bold,
    muted,
  );
  y -= 10;
  const d = record.data;
  section("Business Information");
  for (const [label, value] of [
    ["Legal Company Name", d.legal_name],
    ["Entity Type", d.entity_type],
    ["Federal Tax ID / EIN", d.ein],
    ["State of Incorporation", d.incorporation_state],
    ["Business Inception Date", date(d.inception_date)],
    [
      "Business Address",
      address(
        d.business_address,
        d.business_city,
        d.business_state,
        d.business_zip,
      ),
    ],
  ])
    row(label, value);
  for (const [i, o] of d.owners.entries()) {
    // Keep a normal owner table together instead of leaving its last row alone
    // on the next page. Longer values still use row-level overflow handling.
    ensure(250);
    section(i ? "Second Owner Information" : "Owner Information");
    for (const [label, value] of [
      ["Owner Name", o.name],
      ["Owner Email", o.email],
      ["SSN", o.ssn],
      ["Date of Birth", date(o.date_of_birth)],
      ["Cell Phone", o.phone],
      ["Owner Address", address(o.address, o.city, o.state, o.zip)],
      ["Ownership Percentage", o.ownership === "" ? "" : `${o.ownership}%`],
    ])
      row(label, value);
  }
  row("Is there a 2nd Owner?", d.owners.length > 1 ? "Yes" : "No");
  section("Commercial Information");
  row("Commercial Name", d.commercial_name);
  row("Commercial Email", d.commercial_email);
  newPage();
  section("Uploaded Documents");
  if (!options.files.length) row("Documents", "No additional files attached");
  options.files.forEach((f, i) => row(`Document ${i + 1}`, f.name));
  section("Disclosures & Authorization");
  y -= 9;
  paragraph(record.declaration || options.declaration);
  ensure(205);
  section("Signature");
  y -= 12;
  if (record.signature) {
    const s = record.signature,
      image = await pdf.embedPng(s.image),
      dimensions = image.scaleToFit(250, 65);
    page.drawImage(image, {
      x: 54,
      y: y - dimensions.height,
      width: dimensions.width,
      height: dimensions.height,
    });
    y -= dimensions.height + 10;
    page.drawLine({
      start: { x: 54, y },
      end: { x: 350, y },
      thickness: 0.6,
      color: rule,
    });
    y -= 4;
    row("Signed By", s.name);
    row("Capacity", `Authorized representative of ${d.legal_name}`);
    row("Signed At", s.signed_at);
    row("Authorization", "Representative confirmed authorization to sign.");
  } else {
    y -= 35;
    page.drawLine({
      start: { x: 54, y },
      end: { x: 350, y },
      thickness: 0.6,
      color: rule,
    });
    y -= 19;
    text(
      "Unsigned - signature required before submission.",
      54,
      y,
      9,
      font,
      muted,
    );
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: 44, y: 37 },
      end: { x: 568, y: 37 },
      thickness: 0.5,
      color: rule,
    });
    p.drawText("Curated Financial  |  Confidential", {
      x: 44,
      y: 23,
      size: 8,
      font,
      color: muted,
    });
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: 540,
      y: 23,
      size: 8,
      font,
      color: muted,
    });
  });
  return pdf.save();
}
