import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  caseProgressResponse,
  readCaseProgress,
} from "../src/lib/server/case-progress";
import { HttpError } from "../src/lib/server/supabase";
import { buildCaseProgress } from "../src/lib/pipeline-os/case-progress";
import { progressFixture, progressNow } from "./fixtures/case-progress";

function database(
  options: {
    denied?: boolean;
    missing?: boolean;
    duplicate?: boolean;
    changed?: boolean;
    failed?: boolean;
  } = {},
) {
  const source = progressFixture();
  if (options.denied) source.opportunity.closer_id = "another-owner";
  const ledger: {
    table: string;
    columns: string;
    offset: number;
    filters: Record<string, unknown>;
  }[] = [];
  const tables: Record<string, unknown[]> = {
    documents: source.documents,
    analyses: source.analyses,
    financing_processes: source.processes,
    submissions: source.submissions,
    offers: source.offers,
    case_events: source.events,
    underwriting_runs: source.reports || [],
    mail_conversations_visible: source.conversations || [],
    messages: source.messages || [],
    lenders: source.lenders || [],
    lender_contacts: [],
  };
  const db = {
    from(table: string) {
      assert.ok(table === "opportunity_workspace" || table in tables, table);
      const record = {
        table,
        columns: "",
        offset: -1,
        filters: {} as Record<string, unknown>,
      };
      ledger.push(record);
      const query = {
        select(columns: string) {
          record.columns = columns;
          return query;
        },
        eq(key: string, value: unknown) {
          record.filters[key] = value;
          return query;
        },
        in(key: string, value: unknown) {
          record.filters[key] = value;
          return query;
        },
        is(key: string, value: unknown) {
          record.filters[key] = value;
          return query;
        },
        order(key: string) {
          assert.equal(key, table === "lender_contacts" ? "email" : "id");
          return query;
        },
        async maybeSingle() {
          return {
            data: options.missing ? null : source.opportunity,
            error: null,
          };
        },
        async range(offset: number) {
          record.offset = offset;
          const rows = tables[table];
          // Simulate a REST cap of one even when the caller asks for 500.
          const page = rows.slice(offset, offset + 1);
          if (options.duplicate && table === "documents" && offset > 0)
            page[0] = rows[0];
          return {
            data: page,
            count:
              rows.length +
              Number(!!options.changed && table === "documents" && offset > 0),
            error:
              options.failed && table === "documents"
                ? { message: "fictional-db-error" }
                : null,
          };
        },
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, source, ledger };
}
test("AC009/010: RLS client, one-case filters, complete pagination and projection-only response", async () => {
  const { db, source, ledger } = database();
  const progress = await readCaseProgress(
    db,
    source.profile,
    source.opportunity.id,
  );
  assert.equal(progress.caseId, source.opportunity.id);
  assert.equal(ledger[0].filters.archived_at, null);
  assert.equal(progress.phases[0].state, "complete");
  assert.equal(ledger.filter((r) => r.table === "documents").length, 5);
  for (const row of ledger)
    if (!["messages", "lenders", "lender_contacts"].includes(row.table))
      assert.equal(
        row.filters[
          row.table === "opportunity_workspace" ? "id" : "opportunity_id"
        ],
        source.opportunity.id,
      );
  const text = JSON.stringify(progress);
  for (const privateValue of [
    "Resumen ficticio",
    "Conclusión ficticia",
    "fictional/file",
    "fixture-hash",
    "reviewer_id",
    "actual_funded_amount",
  ])
    assert.ok(!text.includes(privateValue), privateValue);
  assert.ok(ledger.every((r) => !r.columns.includes("body")));
});
test("AC009: access is checked before reading related metadata; missing and foreign cases are indistinguishable", async () => {
  for (const options of [{ missing: true }, { denied: true }]) {
    const { db, source, ledger } = database(options);
    source.profile.role = "closer";
    await assert.rejects(
      () => readCaseProgress(db, source.profile, source.opportunity.id),
      (e) => e instanceof HttpError && e.status === 404,
    );
    assert.deepEqual(
      ledger.map((r) => r.table),
      ["opportunity_workspace"],
    );
  }
});
test("AC009: a previous seller does not query private financial records", async () => {
  const { db, source, ledger } = database();
  source.profile.role = "seller";
  source.opportunity.seller_id = source.profile.id;
  source.opportunity.closer_id = "different-current-owner";
  const progress = await readCaseProgress(
    db,
    source.profile,
    source.opportunity.id,
  );
  assert.deepEqual([...new Set(ledger.map((r) => r.table))].sort(), [
    "analyses",
    "documents",
    "opportunity_workspace",
    "underwriting_runs",
  ]);
  assert.ok(progress.phases.slice(2).every((p) => p.state === "restricted"));
});
test("AC010: duplicate pages, changing totals and database errors fail closed instead of reporting missing evidence", async () => {
  for (const options of [
    { duplicate: true },
    { changed: true },
    { failed: true },
  ]) {
    const { db, source } = database(options);
    await assert.rejects(() =>
      readCaseProgress(db, source.profile, source.opportunity.id),
    );
  }
});
test("AC009/010: GET validates case before loader and keeps successes and errors private/no-store", async () => {
  let called = 0;
  const load = async () => {
    called++;
    return buildCaseProgress(progressFixture(), progressNow);
  };
  for (const suffix of ["", "?case=not-a-uuid"]) {
    const r = await caseProgressResponse(
      new Request(
        `https://example.invalid/api/pipeline-os/case-progress${suffix}`,
      ),
      load,
    );
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(called, 0);
  const request = new Request(
    `https://example.invalid/api/pipeline-os/case-progress?case=${progressFixture().opportunity.id}`,
  );
  const success = await caseProgressResponse(request, load);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("cache-control"), "private, no-store");
  for (const status of [401, 403, 404, 503]) {
    const r = await caseProgressResponse(request, async () => {
      throw new HttpError(status, "Access unavailable");
    });
    assert.equal(r.status, status);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  }
  const failed = await caseProgressResponse(request, async () => {
    throw new Error("private failure content");
  });
  assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes("private failure content"));
});
