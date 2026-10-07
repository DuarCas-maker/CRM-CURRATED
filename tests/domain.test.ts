import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  normalizeEmail,
  validEmail,
  eligibleForCampaign,
  mapVerification,
  renderTemplate,
  handoffErrors,
  canSeeOpportunity,
  canSeeArea,
} from "../src/lib/domain";
import { detectMapping, normalizeRow } from "../src/lib/imports";
import { demoWorkspace } from "../src/lib/demo";
import { encrypt, decrypt } from "../src/lib/server/crypto";
import { parseImport } from "../src/lib/server/parse-import";
import { applicationPdf } from "../worker/pdf";
import { buildMime, messageText } from "../worker/mime";
import { applicationSchema, demoDeclaration } from "../src/lib/application";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
test("email normalization preserves provider-specific identity and suppressions", () => {
  assert.equal(normalizeEmail(" A.B+one@Example.COM "), "a.b+one@example.com");
  assert.ok(validEmail("a.b+one@example.com"));
  assert.ok(!validEmail("missing@domain"));
  for (const status of ["pending", "uncertain", "invalid"] as const)
    assert.equal(eligibleForCampaign(status, false, false), false);
  assert.equal(eligibleForCampaign("valid", true, false), false);
  assert.equal(eligibleForCampaign("valid", false, true), false);
  assert.equal(eligibleForCampaign("valid", false, false), true);
  assert.equal(mapVerification("unknown"), "uncertain");
});
test("template activation fails on missing and blank values", () => {
  assert.equal(renderTemplate("Hi {{ name }}", { name: "Ana" }), "Hi Ana");
  assert.throws(() => renderTemplate("{{missing}}", { name: "Ana" }));
  assert.throws(() => renderTemplate("{{company}}", { company: "" }));
});
test("seller permissions and handoff prerequisites", () => {
  const d = demoWorkspace();
  const seller = d.profiles.find((p) => p.id === "u2")!;
  assert.equal(canSeeOpportunity(seller, d.opportunities[1]), false);
  const handed = d.opportunities.find(
    (o) => o.seller_id === seller.id && o.handed_off_at,
  )!;
  assert.equal(canSeeOpportunity(seller, handed), true);
  assert.equal(canSeeArea(seller, handed, "closer"), false);
  assert.ok(
    handoffErrors(d.opportunities[0], d.documents, d.analyses).length > 0,
  );
  assert.deepEqual(
    handoffErrors(d.opportunities[2], d.documents, d.analyses),
    [],
  );
});
test("50,000 CSV rows with arbitrary headings are mapped and validated", async () => {
  const csv =
    "Business Email,Nombre completo,Empresa,Phone Number\n" +
    Array.from(
      { length: 50000 },
      (_, i) => `person${i}@example.com,Person ${i},Business ${i},555-0100`,
    ).join("\n");
  const parsed = await parseImport(new File([csv], "large.csv"));
  assert.equal(parsed.total, 50000);
  const mapping = detectMapping(parsed.headers);
  assert.equal(mapping.email, "Business Email");
  assert.equal(mapping.company, "Empresa");
  assert.equal(mapping.phone, "Phone Number");
  const valid = parsed.rows
    .map((r) => normalizeRow(r, mapping))
    .filter((r) => r.valid);
  assert.equal(valid.length, 50000);
});
test("Excel supports selecting a non-first sheet", async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Notes").addRow(["Not a lead list"]);
  const leads = book.addWorksheet("Prospects");
  leads.addRow(["Correo electrónico", "Empresa", "Nombre"]);
  leads.addRow(["owner@example.com", "Test LLC", "Ana"]);
  const bytes = await book.xlsx.writeBuffer();
  const parsed = await parseImport(
    new File([new Uint8Array(bytes)], "multi.xlsx"),
    "Prospects",
  );
  assert.equal(parsed.sheet, "Prospects");
  assert.equal(parsed.total, 1);
  assert.equal(detectMapping(parsed.headers).email, "Correo electrónico");
});
test("credentials use authenticated encryption with a unique nonce", () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const a = encrypt("private-test-value");
  const b = encrypt("private-test-value");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "private-test-value");
  const parts = a.split(".");
  parts[2] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
});
test("MIME headers reject injection and preserve reply thread headers", () => {
  const input = {
    from: "sender@example.com",
    to: "lead@example.com",
    subject: "Hello",
    body: "Test",
    messageId: "<unique@example.com>",
    inReplyTo: "<previous@example.com>",
  };
  assert.throws(() =>
    buildMime({ ...input, to: "lead@example.com\r\nBcc: other@example.com" }),
  );
  const raw = Buffer.from(buildMime(input), "base64url").toString();
  assert.ok(raw.includes("In-Reply-To: <previous@example.com>"));
  assert.ok(raw.includes("Message-ID: <unique@example.com>"));
  assert.equal(
    messageText({
      mimeType: "text/plain",
      body: { data: Buffer.from("Reply").toString("base64url") },
    }),
    "Reply",
  );
});
test("application PDF preserves submitted signature and creates paginated output", async () => {
  const input = applicationSchema.parse({
    legal_name: "Compañía Test LLC",
    dba: "Test",
    entity_type: "LLC",
    ein: "12-3456789",
    business_phone: "555-010-1000",
    business_email: "owner@example.com",
    address: "123 Test Street",
    city: "Miami",
    state: "FL",
    zip: "33101",
    established: "2020-01-01",
    industry: "Services",
    annual_revenue: 200000,
    requested_amount: 50000,
    purpose: "Business growth",
    owners: [
      {
        name: "Ana María",
        title: "Owner",
        email: "owner@example.com",
        phone: "555-010-1000",
        ownership: 100,
        address: "123 Test Street",
      },
    ],
    signature_name: "Ana María",
    consent: true,
  });
  const bytes = await applicationPdf(
    {
      ...input,
      declaration: demoDeclaration.repeat(8),
      declaration_version: "test-v1",
    },
    "2026-10-05T12:00:00Z",
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
  assert.equal(
    pdf.getTitle(),
    "Curated Financial · Business Financing Application",
  );
  assert.equal(
    pdf.getCreationDate()?.toISOString(),
    "2026-10-05T12:00:00.000Z",
  );
});
