import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { initializeDocumentChecklist } from "../src/lib/server/document-checklist";
import { demoWorkspace } from "../src/lib/demo";
import { demoAction } from "../src/lib/demo-actions";

test("empty imported opportunities can prepare required documents once without approving any file", async () => {
  let hasDocuments = false,
    writeCalls = 0;
  const audits: Record<string, unknown>[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      assert.equal(name, "can_edit_case");
      assert.deepEqual(args, { case_id: "case" });
      return { data: true, error: null };
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          assert.equal(value, "case");
          assert.equal(
            key,
            table === "opportunities" ? "id" : "opportunity_id",
          );
          return query;
        },
        maybeSingle: async () => ({
          data: { id: "case", product: "MCA" },
          error: null,
        }),
        limit: async () => ({
          data: hasDocuments ? [{ id: "existing" }] : [],
          error: null,
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const service = {
    rpc: async (name: string, args: unknown) => {
      assert.equal(name, "initialize_checklist");
      assert.deepEqual(args, { case_id: "case", product_name: "MCA" });
      writeCalls++;
      hasDocuments = true;
      return { data: null, error: null };
    },
    from: (name: string) => {
      assert.equal(name, "audit_log");
      return {
        insert: async (p: Record<string, unknown>) => {
          audits.push(p);
          return { data: null, error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  await initializeDocumentChecklist(db, "case", "reviewer", () => service);
  await initializeDocumentChecklist(db, "case", "reviewer", () => service);
  assert.equal(writeCalls, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_id, "reviewer");
});

test("a read-only opportunity cannot initialize documents or access the privileged writer", async () => {
  let privileged = false;
  const db = {
    rpc: async () => ({ data: false, error: null }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    initializeDocumentChecklist(db, "other-case", "reviewer", () => {
      privileged = true;
      throw new Error("Must not be called");
    }),
    /read-only/,
  );
  assert.equal(privileged, false);
});

test("the empty Gmail demo case creates an application and four unique pending statements and keeps them on retry", () => {
  const initial = demoWorkspace(),
    op = initial.opportunities.find((o) => o.id === "o1")!;
  initial.documents = initial.documents.filter(
    (d) => d.opportunity_id !== op.id,
  );
  const prepared = demoAction(
    initial,
    initial.profile,
    "initialize_document_checklist",
    { opportunity_id: op.id },
  );
  const repeated = demoAction(
    prepared,
    prepared.profile,
    "initialize_document_checklist",
    { opportunity_id: op.id },
  );
  const docs = repeated.documents.filter((d) => d.opportunity_id === op.id);
  assert.equal(docs.length, 5);
  assert.equal(docs.filter((d) => d.kind === "application").length, 1);
  assert.equal(
    new Set(
      docs.filter((d) => d.kind === "bank_statement").map((d) => d.period),
    ).size,
    4,
  );
  assert.ok(
    docs.every(
      (d) => d.status === "pending" && d.required === true && !d.storage_path,
    ),
  );
});
