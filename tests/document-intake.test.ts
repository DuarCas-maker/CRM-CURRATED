import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import {
  intakeDestination,
  suggestBankFromFilename,
  receiveDocumentSchema,
  hasDocumentFile,
} from "../src/lib/document-intake";
import { documentProgress } from "../src/lib/document-labels";
import {
  classificationRequest,
  classifyDocument,
} from "../src/lib/server/document-classification";
import type { Document } from "../src/lib/domain";

test("intake reuses empty slots, counts BMO files across banks, and never suggests a tax return from a filename", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const contact = randomUUID(),
      opportunity = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'intake@example.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
      [opportunity, contact, users.seller],
    );
    await db.query("select initialize_checklist($1,'MCA')", [opportunity]);
    const read = async () =>
      (
        await db.query<Document>(
          "select * from documents where opportunity_id=$1 order by statement_number,created_at,id",
          [opportunity],
        )
      ).rows;
    const initial = await read();
    const firstTarget = intakeDestination(initial, "bank_statement", "BMO");
    assert.equal(firstTarget.number, 1);
    assert.ok(firstTarget.document);
    const build = async (index: number, approve = false, bank = "BMO") => {
      const destination = intakeDestination(
          await read(),
          "bank_statement",
          bank,
        ),
        id = destination.document?.id || randomUUID(),
        hash = String(index).repeat(64),
        path = `${opportunity}/${id}/${hash}.pdf`;
      await db.query(
        "insert into storage.objects(bucket_id,name) values('case-documents',$1)",
        [path],
      );
      return {
        opportunity_id: opportunity,
        document_id: id,
        kind: "bank_statement",
        bank_name: bank,
        name: "",
        source: "upload",
        source_id: randomUUID(),
        content_hash: hash,
        expected_source_hash: hash,
        storage_path: path,
        expected_target_hash: null,
        approve,
        confirmed: approve,
      };
    };
    const receive = (p: object, key = randomUUID(), actor = users.seller) =>
      db.query("select receive_case_document($1,$2,$3) result", [
        p,
        key,
        actor,
      ]);
    const first = await build(1),
      key = randomUUID();
    await receive(first, key);
    await receive(first, key);
    assert.equal((await read()).filter(hasDocumentFile).length, 1);
    assert.equal(
      (await read()).find((d) => d.id === first.document_id)?.statement_number,
      1,
    );
    await receive(await build(2));
    await receive(await build(3));
    await receive(await build(4));
    const bmo = await read(),
      progress = documentProgress(bmo);
    assert.equal(
      bmo.filter((d) => d.kind === "bank_statement").length,
      4,
      "fills existing slots instead of creating four duplicates",
    );
    assert.equal(progress.receivedStatements, 4);
    assert.equal(progress.statements, 0);
    assert.equal(progress.missingStatements, 0);
    assert.ok(bmo.filter(hasDocumentFile).every((d) => d.bank_name === "BMO"));
    assert.deepEqual(suggestBankFromFilename("BMO - September.pdf", bmo), {
      bank: "BMO",
      source: "filename",
    });
    assert.equal(
      suggestBankFromFilename("TX-First-July.pdf", bmo).bank,
      "Texas First Bank",
    );
    assert.equal(
      suggestBankFromFilename("f1040.pdf", bmo).source,
      "only_bank",
      "a bank fallback does not classify a document type",
    );
    const fifth = await build(5, true, "Second Bank");
    await receive(fifth);
    assert.equal(
      (await read()).find((d) => d.id === fifth.document_id)?.statement_number,
      1,
    );
    const after = await read();
    assert.equal(documentProgress(after).receivedStatements, 5);
    assert.equal(documentProgress(after).statements, 1);
    await assert.rejects(
      receive({
        ...fifth,
        source_id: randomUUID(),
        approve: true,
        confirmed: false,
      }),
      /Confirm you reviewed/,
    );
    await assert.rejects(
      receive({
        ...fifth,
        source_id: randomUUID(),
        approve: false,
        confirmed: false,
      }),
      /Document changed/,
    );
    await assert.rejects(
      receive({
        ...first,
        document_id: randomUUID(),
        content_hash: "f".repeat(64),
      }),
      /Source file changed/,
    );
    await assert.rejects(
      receive(
        { ...first, document_id: randomUUID() },
        randomUUID(),
        users.outsider,
      ),
      /read-only/,
    );
    assert.equal(
      (await read()).length,
      after.length,
      "failed intake rolls back row creation",
    );
    await asUser(users.seller);
    await assert.rejects(
      db.query("select receive_case_document($1,$2,$3)", [
        first,
        randomUUID(),
        users.seller,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from document_classifications"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("intake requires a bank, approval confirmation and exact source version", () => {
  const base = {
    opportunity_id: randomUUID(),
    source: "saved",
    source_id: randomUUID(),
    kind: "bank_statement",
    expected_source_hash: "a".repeat(64),
  };
  assert.equal(receiveDocumentSchema.safeParse(base).success, false);
  assert.equal(
    receiveDocumentSchema.safeParse({ ...base, bank_name: "BMO" }).success,
    true,
  );
  assert.equal(
    receiveDocumentSchema.safeParse({
      ...base,
      bank_name: "BMO",
      approve: true,
    }).success,
    false,
  );
  assert.equal(
    receiveDocumentSchema.safeParse({
      ...base,
      bank_name: "BMO",
      approve: true,
      confirmed: true,
    }).success,
    true,
  );
});

test("conversation intake atomically links original bytes and approval, preserves retries and rolls back cross-file associations", async () => {
  const { db, users } = await featureDatabase();
  try {
    const contact = randomUUID(),
      opportunity = randomUUID(),
      account = randomUUID(),
      conversation = randomUUID(),
      message = randomUUID(),
      attachment = randomUUID(),
      document = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'conversation-intake@example.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
      [opportunity, contact, users.seller],
    );
    await db.query(
      "insert into mail_accounts(id,email,organization,owner_id) values($1,'seller@team.test','org',$2)",
      [account, users.seller],
    );
    await db.query(
      "insert into conversations(id,opportunity_id,account_id,gmail_thread_id,subject,area) values($1,$2,$3,'fixture','Files','seller')",
      [conversation, opportunity, account],
    );
    await db.query(
      "insert into messages(id,conversation_id,gmail_message_id,direction,sender,body,sent_at,status) values($1,$2,'message','inbound','fixture@example.test','Files',now(),'received')",
      [message, conversation],
    );
    await db.query(
      "insert into message_attachments(id,message_id,gmail_attachment_id,name,mime_type,size) values($1,$2,'part','f1040.pdf','application/pdf',100)",
      [attachment, message],
    );
    const content = "a".repeat(64),
      path = `${opportunity}/${document}/${content}.pdf`;
    await db.query(
      "insert into storage.objects(bucket_id,name) values('case-documents',$1)",
      [path],
    );
    const p = {
      opportunity_id: opportunity,
      document_id: document,
      source: "legacy",
      source_id: attachment,
      kind: "additional",
      bank_name: "",
      name: "Tax return",
      expected_source_hash: content,
      content_hash: content,
      storage_path: path,
      expected_target_hash: null,
      approve: true,
      confirmed: true,
    };
    const key = randomUUID(),
      receive = (payload = p, requestKey = key) =>
        db.query("select receive_case_document($1,$2,$3)", [
          payload,
          requestKey,
          users.seller,
        ]);
    await receive();
    await receive();
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from documents where id=$1",
          [document],
        )
      ).rows[0].status,
      "approved",
    );
    assert.equal(
      (
        await db.query("select * from document_reviews where document_id=$1", [
          document,
        ])
      ).rows.length,
      1,
      "retry does not record a second approval",
    );
    assert.equal(
      (
        await db.query<{ source_attachment_id: string }>(
          "select source_attachment_id from document_versions where document_id=$1",
          [document],
        )
      ).rows[0].source_attachment_id,
      attachment,
    );
    const other = randomUUID(),
      otherPath = `${opportunity}/${other}/${content}.pdf`;
    await db.query(
      "insert into storage.objects(bucket_id,name) values('case-documents',$1)",
      [otherPath],
    );
    await assert.rejects(
      receive(
        { ...p, document_id: other, storage_path: otherPath },
        randomUUID(),
      ),
      /already incorporated/,
    );
    assert.equal(
      (await db.query("select * from documents where id=$1", [other])).rows
        .length,
      0,
      "association failure rolls back the new document row",
    );
  } finally {
    await db.close();
  }
});

test("content classification sends actual bytes with no identifying filename or storage and validates type", async () => {
  const bytes = Buffer.from("%PDF-1.7\nFictional test tax return");
  const body = classificationRequest(bytes, "fixture-model");
  assert.equal(body.store, false);
  assert.match(body.instructions, /Tax returns/);
  assert.doesNotMatch(JSON.stringify(body), /api.key|Bearer/);
  assert.ok(JSON.stringify(body).includes(bytes.toString("base64")));
  const result = await classifyDocument(
    bytes,
    "fixture-model",
    "test-key",
    async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        "Bearer test-key",
      );
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  kind: "additional",
                  name: "Tax return",
                  confidence: "high",
                  reason_es: "Formulario de impuestos.",
                  reason_en: "Tax form.",
                }),
              },
            ],
          },
        ],
      });
    },
  );
  assert.equal(result.kind, "additional");
  await assert.rejects(
    classifyDocument(bytes, "fixture-model", "test-key", async () =>
      Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal" }] }],
      }),
    ),
    /REFUSED/,
  );
});
