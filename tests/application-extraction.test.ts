import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  emptyCompanyApplication,
  companyApplicationSchema,
  bindApplicationAdvisor,
  applicationFilename,
  validateCompleteApplication,
  secondOwnerAnswer,
} from "../src/lib/company-application";
import {
  extractionFields,
  mergeApplicationExtraction,
  normalizeExtractionValue,
  type ExtractionItem,
} from "../src/lib/application-extraction";
import {
  applicationExtractionRequest,
  extractApplication,
} from "../src/lib/server/application-extraction";
import { companyApplicationPdf } from "../src/lib/server/company-application-pdf";
import {
  applicationPdfFilename,
  documentFilename,
} from "../src/lib/server/document-filename";

const item = (
  field: ExtractionItem["field"],
  value: string | null,
  status: ExtractionItem["status"] = "found",
): ExtractionItem => ({
  field,
  value,
  status,
  evidence: [
    { source: "document_1", page: 1, quote: value || "Conflicting evidence" },
  ],
});
const complete = () =>
  companyApplicationSchema.parse({
    legal_name: "Fictional Test LLC",
    entity_type: "LLC",
    ein: "00-0000000",
    incorporation_state: "FL",
    inception_date: "2020-01-01",
    second_owner: "no",
    owners: [
      {
        name: "Fictional Owner",
        ssn: "000-00-0000",
        date_of_birth: "1980-01-01",
        ownership: 100,
      },
    ],
    identifier: "PRIVATE-ADVISOR-ID",
  });

test("extraction preserves current fields, leaves conflicts blank, and requires confirmation for probable values", () => {
  const data = emptyCompanyApplication("Existing Company LLC");
  const result = mergeApplicationExtraction(data, [
    item("legal_name", "Different Company LLC"),
    item("ein", "00-0000000", "conflict"),
    item("owners.0.name", "Probable Owner", "needs_review"),
    item("business_city", "Test City"),
    { ...item("owners.0.phone", "5551234567"), evidence: [] },
  ]);
  assert.equal(result.data.legal_name, "Existing Company LLC");
  assert.equal(result.data.ein, "");
  assert.equal(result.data.owners[0].name, "");
  assert.equal(result.data.business_city, "Test City");
  assert.equal(result.data.owners[0].phone, "");
  assert.deepEqual(
    result.notices.map((n) => n.reason),
    ["different", "conflict", "review", "missing"],
  );
  assert.equal(
    data.business_city,
    "",
    "merge does not mutate a signed or saved snapshot",
  );
});
test("incomplete identifiers, invalid dates, unsupported entities and masked SSNs cannot enter form fields", () => {
  for (const value of [
    "***-**-1234",
    "1234",
    "12345678",
    "1234567890",
    "SSN 123456789",
  ])
    assert.equal(normalizeExtractionValue("owners.0.ssn", value), null);
  assert.equal(normalizeExtractionValue("ein", "123456789"), "12-3456789");
  assert.equal(
    normalizeExtractionValue("owners.0.ssn", "123456789"),
    "123-45-6789",
  );
  assert.equal(normalizeExtractionValue("inception_date", "03/2018"), null);
  assert.equal(normalizeExtractionValue("inception_date", "2020-02-30"), null);
  assert.equal(normalizeExtractionValue("inception_date", "2099-01-01"), null);
  assert.equal(
    normalizeExtractionValue("owners.0.date_of_birth", "2020-01-01"),
    null,
  );
  assert.equal(
    normalizeExtractionValue("owners.0.date_of_birth", "12-16-1982"),
    "1982-12-16",
  );
  assert.equal(
    normalizeExtractionValue("entity_type", "Limited Partnership"),
    "Limited Partnership",
  );
  assert.equal(normalizeExtractionValue("incorporation_state", "Texas"), "TX");
  assert.equal(normalizeExtractionValue("owners.0.ownership", "50.5%"), 50.5);
});
test("unknown owner count blocks generation and extraction never silently drops an existing owner", () => {
  assert.equal(secondOwnerAnswer(emptyCompanyApplication()), "unknown");
  assert.throws(
    () =>
      validateCompleteApplication({ ...complete(), second_owner: "unknown" }),
    /segundo/,
  );
  const inferred = mergeApplicationExtraction(emptyCompanyApplication(), [
    item("second_owner", "yes"),
    item("owners.1.name", "Second Fixture Owner"),
    item("owners.0.ownership", "70"),
    item("owners.1.ownership", "40"),
  ]);
  assert.equal(inferred.data.owners.length, 2);
  assert.equal(inferred.data.owners[1].name, "Second Fixture Owner");
  assert.ok(
    inferred.data.owners.reduce((sum, o) => sum + Number(o.ownership), 0) <=
      100,
  );
  assert.ok(
    inferred.notices.some(
      (n) => n.field === "owners.1.ownership" && n.reason === "conflict",
    ),
  );
  assert.equal(
    mergeApplicationExtraction(inferred.data, [item("second_owner", "no")]).data
      .owners.length,
    2,
  );
  const legacy = complete();
  delete legacy.second_owner;
  validateCompleteApplication(legacy);
});
test("advisor name and hidden ID come only from the selected registered email", () => {
  const advisors = [
    { id: "active-id", name: "Registered Agent", email: "agent@example.test" },
  ];
  const result = bindApplicationAdvisor(
    {
      ...complete(),
      commercial_email: "AGENT@example.test",
      commercial_name: "forged",
      identifier: "forged",
    },
    advisors,
  );
  assert.equal(result.identifier, "active-id");
  assert.equal(result.commercial_name, "Registered Agent");
  assert.throws(
    () =>
      bindApplicationAdvisor(
        { ...complete(), commercial_email: "other@example.test" },
        advisors,
      ),
    /activo/,
  );
  assert.equal(bindApplicationAdvisor(complete(), advisors).identifier, "");
});
test("PDF contains table layout, client filename and immutable metadata, without exposing commercial ID", async () => {
  const data = complete();
  const bytes = await companyApplicationPdf(
    { data, signature: null },
    {
      id: "fixture-id",
      revision: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      declaration: "Fictional disclosure.",
      files: [],
    },
  );
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(
    pdf.getTitle(),
    "Application - Fictional Test LLC - Fictional Owner",
  );
  assert.equal(
    await applicationPdfFilename(bytes, "fallback.pdf"),
    applicationFilename(data),
  );
  const legacy = await PDFDocument.create();
  legacy.setTitle("Uploaded external document");
  assert.equal(
    await applicationPdfFilename(await legacy.save(), "Original.pdf"),
    "Original.pdf",
  );
  assert.equal(
    documentFilename("Application.pdf", "hash.pdf"),
    "Application.pdf",
  );
  assert.equal(
    documentFilename("../../unsafe\nname", "hash.pdf"),
    ".. .. unsafe name.pdf",
  );
});
test("provider request sends only selected documents, uses private structured output, and rejects duplicate results or unsupported inputs", async () => {
  const files = [
    { name: "fixture.pdf", bytes: Buffer.from("%PDF-1.7 fixture") },
  ];
  const body = applicationExtractionRequest(
    files,
    "EIN: 00-0000000",
    "fixture-model",
  );
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.throws(
    () =>
      applicationExtractionRequest(
        [...files, ...files, ...files],
        "",
        "fixture",
      ),
    /two/,
  );
  assert.throws(
    () =>
      applicationExtractionRequest(
        [{ name: "file.txt", bytes: Buffer.from("plain text") }],
        "",
        "fixture",
      ),
    /PDF/,
  );
  const response = (fields: ExtractionItem[]) => async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify({ fields }) }],
        },
      ],
    });
  const fields: ExtractionItem[] = extractionFields.map((field) => ({
    ...item(field, null, "not_found"),
    evidence: [],
  }));
  fields[0] = item("legal_name", "Fictional LLC");
  const result = await extractApplication(
    files,
    "",
    "fixture-model",
    "test-only-key",
    response(fields),
  );
  assert.equal(result.fields[0].value, "Fictional LLC");
  const invalidSources = fields.map((f) => ({
    ...f,
    evidence: [
      { source: "document_2" as const, page: 1, quote: "fake second document" },
    ],
  }));
  assert.equal(
    (
      await extractApplication(
        files,
        "",
        "fixture-model",
        "test-only-key",
        response(invalidSources),
      )
    ).fields[0].value,
    null,
  );
  const duplicate = [...fields];
  duplicate[1] = duplicate[0];
  await assert.rejects(
    extractApplication(
      files,
      "",
      "fixture-model",
      "test-only-key",
      response(duplicate),
    ),
    /Duplicate/,
  );
});
