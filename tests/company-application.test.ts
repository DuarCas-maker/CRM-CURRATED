import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  companyApplicationSchema,
  validateCompleteApplication,
  formatTaxId,
  adultBirthDate,
  usStates,
} from "../src/lib/company-application";
import { companyApplicationPdf } from "../src/lib/server/company-application-pdf";
import { featureDatabase } from "./feature-database";
const data = companyApplicationSchema.parse({
  legal_name: "Fictional Test LLC",
  entity_type: "LLC",
  ein: "00-0000000",
  incorporation_state: "FL",
  inception_date: "2020-01-01",
  business_address: "123 Fictional Street, Test City, FL 00000",
  commercial_name: "Test Agent",
  commercial_email: "agent@example.test",
  identifier: "TEST-ONLY",
  owners: [
    {
      name: "Fictional Owner",
      email: "owner@example.test",
      ssn: "000-00-0000",
      date_of_birth: "1980-01-01",
      phone: "0000000000",
      address: "123 Fictional Street",
      ownership: 100,
    },
  ],
});

test("reference application keeps optional contact/address fields optional and validates formats, dates and both owners", () => {
  const minimal = companyApplicationSchema.parse({
    ...data,
    business_address: "",
    commercial_name: "",
    commercial_email: "",
    identifier: "",
    owners: [
      {
        name: "Fixture Owner",
        ssn: "000-00-0000",
        date_of_birth: "1980-01-01",
        ownership: 50.5,
      },
    ],
  });
  validateCompleteApplication(minimal);
  validateCompleteApplication({
    ...minimal,
    owners: [minimal.owners[0], { ...minimal.owners[0], ownership: 49.5 }],
  });
  assert.equal(formatTaxId("123456789", "ein"), "12-3456789");
  assert.equal(formatTaxId("123456789", "ssn"), "123-45-6789");
  assert.equal(formatTaxId("12-3456789", "ein"), "12-3456789");
  assert.equal(adultBirthDate(new Date("2024-02-29T12:00:00Z")), "2006-02-28");
  assert.equal(usStates.length, 51);
  assert.throws(() =>
    validateCompleteApplication({ ...minimal, ein: "123456789" }),
  );
  assert.throws(() =>
    validateCompleteApplication({ ...minimal, incorporation_state: "XX" }),
  );
  assert.throws(() =>
    validateCompleteApplication({ ...minimal, inception_date: "2020-02-30" }),
  );
  assert.throws(() =>
    validateCompleteApplication({
      ...minimal,
      owners: [{ ...minimal.owners[0], date_of_birth: "2020-01-01" }],
    }),
  );
  assert.throws(() =>
    validateCompleteApplication({
      ...minimal,
      owners: [{ ...minimal.owners[0], ownership: "" }],
    }),
  );
  assert.throws(() =>
    validateCompleteApplication({
      ...minimal,
      owners: [...minimal.owners, { ...minimal.owners[0], ssn: "" }],
    }),
  );
  assert.throws(() =>
    validateCompleteApplication({
      ...minimal,
      owners: [{ ...minimal.owners[0], email: "invalid" }],
    }),
  );
  assert.equal(
    companyApplicationSchema.parse(data).business_city,
    "",
    "legacy records retain old addresses and gain empty structured fields",
  );
});
test("application requires the sample fields and creates an unsigned draft without inventing consent", async () => {
  validateCompleteApplication(data);
  assert.throws(
    () =>
      validateCompleteApplication({
        ...data,
        owners: [{ ...data.owners[0], ssn: "" }],
      }),
    /propietarios/,
  );
  const bytes = await companyApplicationPdf(
    { data, signature: null },
    {
      id: "TEST",
      revision: 1,
      declaration: "Fictional testing declaration only.",
      files: [],
    },
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
});
test("company drafts are versioned, shared by company, private and fenced against stale saves or another case", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const company = randomUUID(),
      contact = randomUUID(),
      first = randomUUID(),
      second = randomUUID(),
      foreign = randomUUID();
    await db.query(
      "insert into companies(id,name) values($1,'Fictional Company')",
      [company],
    );
    await db.query(
      "insert into contacts(id,email,verification) values($1,'fixture@example.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,company_id,contact_id,company,seller_id) values($1,$4,$5,'Fictional Company',$6),($2,$4,$5,'Fictional Company',$6),($3,null,$5,'Other Company',$7)",
      [first, second, foreign, company, contact, users.seller, users.outsider],
    );
    const save = (caseId: string, revision: number, actor = users.seller) =>
      db.query<{ result: { revision: number } }>(
        "select save_company_application($1,$2,$3,$4) result",
        [caseId, "encrypted-fixture", revision, actor],
      );
    await assert.rejects(save(first, 0, users.outsider), /read-only/);
    assert.equal((await save(first, 0)).rows[0].result.revision, 1);
    await assert.rejects(save(second, 0), /changed/);
    assert.equal((await save(second, 1)).rows[0].result.revision, 2);
    assert.equal(
      (await db.query("select * from company_applications")).rows.length,
      1,
    );
    assert.equal(
      (await db.query("select * from company_application_versions")).rows
        .length,
      2,
    );
    await assert.rejects(save(foreign, 0), /read-only/);
    await db.query("select initialize_checklist($1,'MCA')", [first]);
    const doc = (
      await db.query<{ id: string }>(
        "select id from documents where opportunity_id=$1 and kind='application'",
        [first],
      )
    ).rows[0].id;
    const hash = "c".repeat(64),
      path = `${first}/${doc}/${hash}.pdf`;
    await db.query(
      "insert into storage.objects(bucket_id,name) values('case-documents',$1)",
      [path],
    );
    const register = (revision: number) =>
      db.query(
        "select register_company_application_pdf($1,$2,$3,$4,$5,false,$6)",
        [first, doc, revision, path, hash, users.seller],
      );
    await assert.rejects(register(1), /changed/);
    const generations = () =>
      db.query<{ metadata: { revision: number } }>(
        "select metadata from audit_log where entity_type='document' and entity_id=$1 and action='company_application_generated' order by created_at desc",
        [doc],
      );
    assert.equal((await generations()).rows.length, 0);
    await register(2);
    assert.equal((await generations()).rows[0].metadata.revision, 2);
    const received = (
      await db.query<{ status: string; source: string }>(
        "select status,source from documents where id=$1",
        [doc],
      )
    ).rows[0];
    assert.equal(received.status, "received");
    assert.equal(received.source, "company_application");
    await asUser(users.seller);
    await assert.rejects(
      db.query("select * from company_applications"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select save_company_application($1,$2,2,$3)", [
        first,
        "tampered",
        users.seller,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select case_document_command($1,$2,$3)", [
        "review_document",
        {
          opportunity_id: first,
          document_id: doc,
          expected_hash: hash,
          status: "approved",
          notes: "",
          period: "",
        },
        randomUUID(),
      ]),
      /unsigned draft/,
    );
    await db.exec("reset role");
    assert.equal((await save(second, 2)).rows[0].result.revision, 3);
    assert.equal(
      (await generations()).rows[0].metadata.revision,
      2,
      "saving shared company data leaves the incorporated PDF on its older revision",
    );
    await db.query(
      "update opportunities set handed_off_at=now(),closer_id=$2 where id=$1",
      [first, users.closer],
    );
    await assert.rejects(save(first, 2), /read-only/);
  } finally {
    await db.close();
  }
});
