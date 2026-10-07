import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, checked } from "./db";
import { decrypt, hash } from "../src/lib/server/crypto";
import type { ApplicationInput } from "../src/lib/application";
export async function applicationPdf(
  input: ApplicationInput & {
    declaration: string;
    declaration_version: string;
  },
  submittedAt: string,
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Curated Financial · Business Financing Application");
  pdf.setCreationDate(new Date(submittedAt));
  pdf.setModificationDate(new Date(submittedAt));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 737;
  const line = (value: string, heading = false) => {
    const size = heading ? 13 : 10;
    const words = value.replace(/\r/g, "").split(/\s+/);
    let current = "";
    const flush = () => {
      if (y < 60) {
        page = pdf.addPage([612, 792]);
        y = 737;
      }
      page.drawText(current, {
        x: 48,
        y,
        size,
        font: heading ? bold : font,
        color: rgb(0.08, 0.19, 0.16),
      });
      y -= heading ? 24 : 16;
    };
    for (const word of words) {
      const candidate = current ? current + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) > 510 && current) {
        flush();
        current = word;
      } else current = candidate;
    }
    flush();
  };
  line("CURATED FINANCIAL", true);
  line("Business Financing Application", true);
  line(`Submitted: ${submittedAt}`);
  line(`Declaration version: ${input.declaration_version}`);
  y -= 10;
  for (const [label, key] of [
    ["Legal business name", "legal_name"],
    ["DBA", "dba"],
    ["Entity type", "entity_type"],
    ["Federal tax ID", "ein"],
    ["Business phone", "business_phone"],
    ["Business email", "business_email"],
    ["Address", "address"],
    ["City", "city"],
    ["State", "state"],
    ["ZIP", "zip"],
    ["Established", "established"],
    ["Industry", "industry"],
    ["Annual revenue (USD)", "annual_revenue"],
    ["Requested amount (USD)", "requested_amount"],
    ["Purpose", "purpose"],
  ] as const)
    line(`${label}: ${input[key]}`);
  input.owners.forEach((owner, i) => {
    y -= 10;
    line(`Owner ${i + 1}`, true);
    Object.entries(owner).forEach(([label, value]) =>
      line(`${label}: ${value}`),
    );
  });
  y -= 10;
  line("Declarations", true);
  line(input.declaration);
  y -= 10;
  line("Electronic signature", true);
  line(input.signature_name);
  line(
    `Signed and submitted at ${submittedAt}. Consent to electronic signature: yes.`,
  );
  pdf
    .getPages()
    .forEach((p, i) =>
      p.drawText(
        `Curated Financial | Private | ${i + 1} / ${pdf.getPageCount()}`,
        { x: 48, y: 30, font, size: 8, color: rgb(0.45, 0.5, 0.47) },
      ),
    );
  return Buffer.from(await pdf.save());
}
export async function generatePdf(applicationId: string) {
  const client = db();
  const app = checked(
    await client
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .single(),
  )!;
  if (app.pdf_path) return;
  const bytes = await applicationPdf(
    JSON.parse(decrypt(app.encrypted_payload)),
    app.submitted_at,
  );
  const doc = checked(
    await client
      .from("documents")
      .select("id")
      .eq("opportunity_id", app.opportunity_id)
      .eq("kind", "application")
      .single(),
  )!;
  const contentHash = hash(bytes);
  const path = `${app.opportunity_id}/${doc.id}/application-${app.id}.pdf`;
  const upload = await client.storage
    .from("case-documents")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error && !upload.error.message.toLowerCase().includes("exist"))
    throw new Error("PDF_UPLOAD_FAILED");
  checked(
    await client.rpc("register_document", {
      document_id: doc.id,
      path,
      content_hash: contentHash,
      source: "application_pdf",
      actor: null,
    }),
  );
  checked(
    await client
      .from("applications")
      .update({ pdf_path: path })
      .eq("id", app.id),
  );
}
