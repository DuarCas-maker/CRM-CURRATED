import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import { documentProgress } from "../src/lib/document-labels";
import { demoWorkspace } from "../src/lib/demo";

test("bank statements restart numbering per bank, support overlapping periods and enforce four actual files", async () => {
  const { db, users, asUser, command } = await featureDatabase();
  try {
    const contact = randomUUID(),
      opportunity = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'bank-test@example.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fictional merchant',$3)",
      [opportunity, contact, users.seller],
    );
    await db.query("select initialize_checklist($1,'MCA')", [opportunity]);
    await db.query("select initialize_checklist($1,'MCA')", [opportunity]);
    const initial = (
      await db.query<{ id: string; kind: string; period: string }>(
        "select id,kind,period from documents where opportunity_id=$1",
        [opportunity],
      )
    ).rows;
    assert.equal(initial.length, 5);
    assert.ok(initial.every((d) => d.period === ""));
    await asUser(users.outsider);
    const add = {
      opportunity_id: opportunity,
      kind: "bank_statement",
      bank_name: "First Bank",
    };
    await assert.rejects(command("add_document", add), /read-only/);
    await asUser(users.seller);
    const key = randomUUID();
    const first = await command("add_document", add, key);
    assert.deepEqual(await command("add_document", add, key), first);
    await command("add_document", add);
    const second = await command("add_document", {
      ...add,
      bank_name: "Second Bank",
    });
    assert.deepEqual(
      (
        await db.query<{ name: string; bank_name: string }>(
          "select name,bank_name from documents where id in ($1,$2) order by bank_name",
          [first.id, second.id],
        )
      ).rows,
      [
        { name: "Bank Statement 1", bank_name: "First Bank" },
        { name: "Bank Statement 1", bank_name: "Second Bank" },
      ],
    );
    await command("classify_document", {
      opportunity_id: opportunity,
      document_id: initial.find((d) => d.kind === "bank_statement")!.id,
      bank_name: "First Bank",
    });
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from documents where bank_name='First Bank' order by statement_number desc limit 1",
        )
      ).rows[0].name,
      "Bank Statement 3",
    );
    await command("add_document", {
      opportunity_id: opportunity,
      kind: "additional",
      name: "Tax return",
      required: false,
    });
    await command("add_document", {
      opportunity_id: opportunity,
      kind: "additional",
      name: "Tax return",
      required: false,
    });
    await db.exec("reset role");
    await db.query(
      "update documents set status='approved',storage_path='fixture.pdf',content_hash=repeat('a',64),period=case when kind='bank_statement' then '2026-09' else '' end where opportunity_id=$1 and kind in ('application','bank_statement')",
      [opportunity],
    );
    await asUser(users.seller);
    assert.equal(
      (
        await db.query<{ ready: boolean }>(
          "select document_packet_ready($1) ready",
          [opportunity],
        )
      ).rows[0].ready,
      false,
      "One file copied into several slots is insufficient",
    );
    await db.exec("reset role");
    await db.query(
      "update documents set content_hash=repeat(md5(id::text),2) where opportunity_id=$1 and kind='bank_statement'",
      [opportunity],
    );
    await asUser(users.seller);
    assert.equal(
      (
        await db.query<{ ready: boolean }>(
          "select document_packet_ready($1) ready",
          [opportunity],
        )
      ).rows[0].ready,
      true,
      "Optional empty files do not block the minimum package",
    );
    await db.exec("reset role");
    await db.query(
      "insert into underwriting_settings(id,prompt) values(1,'test prompt') on conflict do nothing",
    );
    await asUser(users.seller);
    const run = (
      await db.query<{ id: string }>("select request_underwriting($1,$2) id", [
        opportunity,
        randomUUID(),
      ])
    ).rows[0].id;
    const snapshot = (
      await db.query<{
        document_snapshot: { bank_name: string; kind: string }[];
      }>("select document_snapshot from underwriting_runs where id=$1", [run])
    ).rows[0].document_snapshot;
    assert.equal(snapshot.filter((d) => d.kind === "bank_statement").length, 7);
    assert.ok(snapshot.some((d) => d.bank_name === "Second Bank"));
  } finally {
    await db.close();
  }
});

test("checklist progress counts four distinct approved statements across banks", () => {
  const docs = demoWorkspace().documents.filter(
    (d) => d.opportunity_id === "o3",
  );
  assert.equal(documentProgress(docs).ready, true);
  const sameFile = docs.map((d) => ({
    ...d,
    content_hash: d.kind === "bank_statement" ? "same" : d.id,
  }));
  assert.equal(documentProgress(sameFile).ready, false);
  assert.equal(documentProgress(sameFile).statements, 1);
});
