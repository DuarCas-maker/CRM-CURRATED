import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { featureDatabase } from "./feature-database";
import {
  lenderImportRowSchema,
  planLenderImport,
  emptyLenderGuidelines,
  lenderGuidelinesSchema,
} from "../src/lib/lender-management";
import { lenderCataloguePdf } from "../src/lib/server/lender-catalogue-pdf";
test("lender import groups explicit company names and detects email ownership conflicts", () => {
  const rows = [
    { company: "Alpha", email: "a@alpha.test", contact: "A" },
    { company: " alpha ", email: "b@alpha.test", contact: "B" },
    { company: "Alpha", email: "a@alpha.test", contact: "A" },
  ].map((r) => lenderImportRowSchema.parse(r));
  const plan = planLenderImport(rows, [], []);
  assert.equal(plan.new_companies, 1);
  assert.equal(plan.new_contacts, 2);
  assert.equal(plan.duplicate_rows, 1);
  assert.equal(
    planLenderImport(
      rows,
      [{ id: "beta", name: "Beta" }],
      [{ lender_id: "beta", email: "a@alpha.test" }],
    ).errors.length,
    2,
  );
  assert(
    !lenderGuidelinesSchema.safeParse({
      ...emptyLenderGuidelines,
      verified: true,
    }).success,
  );
  assert(
    !lenderImportRowSchema.safeParse({
      company: "Internal",
      email: "name@curatedfinancial.com",
    }).success,
  );
});
test("bulk imports are atomic and idempotent; guidelines retain history and AI snapshots", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const rows = [
        {
          company: "Test Import Alpha",
          email: "alpha@fictional.test",
          contact: "Alice",
          channel: "email",
          products: "MCA",
        },
        {
          company: "Test Import Alpha",
          email: "bob@fictional.test",
          contact: "Bob",
          channel: "email",
        },
      ],
      key = randomUUID();
    const run = () =>
      db.query<{ result: { new_companies: number; new_contacts: number } }>(
        "select import_lender_directory($1,$2) result",
        [rows, key],
      );
    await asUser(users.seller);
    await assert.rejects(run(), /administrator/);
    await asUser(users.admin, "aal1");
    await assert.rejects(run(), /MFA/);
    await asUser(users.admin);
    const result = (await run()).rows[0].result;
    assert.equal(result.new_companies, 1);
    assert.equal(result.new_contacts, 2);
    assert.deepEqual((await run()).rows[0].result, result);
    const lender = (
      await db.query<{ id: string }>(
        "select id from lenders where name='Test Import Alpha'",
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query("select * from lender_contacts where lender_id=$1", [
          lender,
        ])
      ).rows.length,
      2,
    );
    await assert.rejects(
      db.query("select import_lender_directory($1,$2)", [
        [
          {
            company: "Should Roll Back",
            email: "new@fictional.test",
            channel: "email",
          },
          { company: "Other", email: "alpha@fictional.test", channel: "email" },
        ],
        randomUUID(),
      ]),
      /another company/,
    );
    assert.equal(
      (await db.query("select id from lenders where name='Should Roll Back'"))
        .rows.length,
      0,
    );
    const guidelines = {
      ...emptyLenderGuidelines,
      tier: "2",
      min_credit: 650,
      verified: true,
      source: "Fictional lender confirmation",
      as_of: "2026-10-14",
    };
    const save = (version: number, g = guidelines) =>
      db.query("select save_lender_guidelines($1,$2,$3,$4)", [
        lender,
        g,
        version,
        randomUUID(),
      ]);
    await save(0);
    await assert.rejects(save(0), /changed/);
    await db.exec("reset role");
    const contact = randomUUID(),
      caseId = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'case@fictional.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fictional',$3)",
      [caseId, contact, users.seller],
    );
    const runId = (
      await db.query<{ id: string }>(
        "insert into underwriting_runs(opportunity_id,requested_by,request_key,model,prompt,prompt_version,max_output_tokens,document_snapshot,lender_snapshot) values($1,$2,$3,'gpt-6.1-sol','Fixture',1,8000,'[]','[]') returning id",
        [caseId, users.seller, randomUUID()],
      )
    ).rows[0].id;
    await asUser(users.admin);
    await save(1, { ...guidelines, min_credit: 700 });
    const history = await db.query(
      "select * from lender_guideline_versions where lender_id=$1",
      [lender],
    );
    assert.equal(history.rows.length, 2);
    await db.exec("reset role");
    const snapshot = (
      await db.query<{
        lender_snapshot: {
          id: string;
          guidelines: { min_credit: number };
          guideline_version: number;
        }[];
      }>("select lender_snapshot from underwriting_runs where id=$1", [runId])
    ).rows[0].lender_snapshot.find((l) => l.id === lender)!;
    assert.equal(snapshot.guidelines.min_credit, 650);
    assert.equal(snapshot.guideline_version, 1);
    await asUser(users.seller);
    await assert.rejects(save(2), /administrator/);
  } finally {
    await db.close();
  }
});
test("reference tier PDF remains a real paginated document", async () => {
  const bytes = await lenderCataloguePdf();
  const pdf = await PDFDocument.load(bytes);
  assert(pdf.getPageCount() >= 1);
  const long = await PDFDocument.load(await lenderCataloguePdf(Array.from({length: 100}, (_, i) => ({id:String(i),name:`Fictional lender ${i}`,products:[],email:"",channel:"portal",notes:""}))));
  assert(long.getPageCount() > 2);
  assert.equal(pdf.getTitle(), "Curated Financial - Lender tiers");
});
