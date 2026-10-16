import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "./feature-database";
import { planBankMove } from "../src/lib/bank-document-management";
import type { Document } from "../src/lib/domain";

test("bank moves and reorders are atomic, idempotent, preserve approval and reject stale or foreign input", async () => {
  const { db, users, asUser } = await featureDatabase();
  try {
    const contact = randomUUID(),
      opportunity = randomUUID(),
      foreign = randomUUID();
    await db.query(
      "insert into contacts(id,email,verification) values($1,'move-fixture@example.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$3,'Fixture',$4),($2,$3,'Other',$5)",
      [opportunity, foreign, contact, users.seller, users.outsider],
    );
    const ids = Array.from({ length: 5 }, () => randomUUID());
    for (let i = 0; i < ids.length; i++)
      await db.query(
        "insert into documents(id,opportunity_id,name,kind,bank_name,statement_number,status,storage_path,content_hash,reviewed_by,reviewed_at) values($1,$2,$3,'bank_statement',$4,$5,'approved','fixture.pdf',repeat('a',64),$6,'2026-01-01')",
        [
          ids[i],
          i === 4 ? foreign : opportunity,
          `Bank Statement ${(i % 2) + 1}`,
          i < 2 ? "First Bank" : "Second Bank",
          (i % 2) + 1,
          users.seller,
        ],
      );
    const read = async () =>
      (
        await db.query<Document>(
          "select * from documents where opportunity_id=$1 order by bank_name,statement_number",
          [opportunity],
        )
      ).rows;
    await asUser(users.seller);
    const initial = await read();
    const payload = {
      opportunity_id: opportunity,
      document_ids: [ids[1], ids[0]],
      bank_name: "second bank",
      position: 2,
      expected_documents: initial.map((d) => ({
        id: d.id,
        bank_name: d.bank_name,
        statement_number: d.statement_number,
      })),
    };
    const move = (p = payload, key = randomUUID()) =>
      db.query("select move_bank_documents($1,$2) result", [p, key]);
    const key = randomUUID();
    const result = await move(payload, key);
    assert.deepEqual(await move(payload, key), result);
    const after = await read();
    for (const document of after) {
      const {
        bank_name: _bank,
        statement_number: _number,
        name: _name,
        ...preserved
      } = document;
      const {
        bank_name: _oldBank,
        statement_number: _oldNumber,
        name: _oldName,
        ...original
      } = initial.find((d) => d.id === document.id)!;
      assert.deepEqual(
        preserved,
        original,
        "classification cannot change file, review, notes or provenance",
      );
    }
    assert.deepEqual(
      after.map((d) => d.id),
      [ids[2], ids[1], ids[0], ids[3]],
    );
    assert.deepEqual(
      after.map((d) => d.statement_number),
      [1, 2, 3, 4],
    );
    assert.ok(
      after.every(
        (d) =>
          d.bank_name === "Second Bank" &&
          d.status === "approved" &&
          d.content_hash === "a".repeat(64) &&
          d.reviewed_by === users.seller &&
          d.storage_path === "fixture.pdf",
      ),
    );
    assert.deepEqual(
      planBankMove(
        initial,
        payload.document_ids,
        payload.bank_name,
        payload.position,
      )
        .sort((a, b) => a.statement_number! - b.statement_number!)
        .map((d) => [d.id, d.bank_name, d.statement_number]),
      after.map((d) => [d.id, d.bank_name, d.statement_number]),
    );
    await assert.rejects(move(), /Documents changed/);
    await assert.rejects(
      move({ ...payload, document_ids: [ids[4]] }),
      /belong to this opportunity/,
    );
    await assert.rejects(
      move({ ...payload, document_ids: [ids[0], ids[0]] }),
      /distinct bank statements/,
    );
    const next = {
      ...payload,
      document_ids: [ids[3]],
      position: 1,
      expected_documents: after.map((d) => ({
        id: d.id,
        bank_name: d.bank_name,
        statement_number: d.statement_number,
      })),
    };
    await assert.rejects(
      move({ ...next, position: 99 }),
      /Invalid statement position/,
    );
    assert.deepEqual(
      await read(),
      after,
      "invalid moves leave all statements unchanged",
    );
    await move(next);
    assert.deepEqual(
      (await read()).map((d) => d.id),
      [ids[3], ids[2], ids[1], ids[0]],
      "same-bank reordering has no unique index collisions",
    );
    await asUser(users.outsider);
    await assert.rejects(move(next), /read-only/);
    await asUser(users.seller, "aal1");
    await assert.rejects(move(next), /MFA required/);
  } finally {
    await db.close();
  }
});
