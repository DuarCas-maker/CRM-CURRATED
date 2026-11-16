import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pipelineModuleDemo } from "../src/lib/pipeline-os/demo";
import { parseMasterQuery } from "../src/lib/pipeline-os/master-pipeline";
import { readMasterPipeline } from "../src/lib/server/pipeline-master";

type Row = Record<string, unknown>;
function database(
  tables: Record<string, Row[]>,
  cap = 500,
  missingCount = false,
) {
  const calls: {
    table: string;
    columns: string;
    filters: { key: string; values: unknown[] }[];
    start: number;
    end: number;
  }[] = [];
  class Query {
    columns = "";
    filters: { key: string; values: unknown[] }[] = [];
    since: { key: string; value: string } | null = null;
    constructor(readonly table: string) {}
    select(columns: string) {
      this.columns = columns;
      return this;
    }
    order() {
      return this;
    }
    in(key: string, values: unknown[]) {
      this.filters.push({ key, values });
      return this;
    }
    is() {
      return this;
    }
    gte(key: string, value: string) {
      this.since = { key, value };
      return this;
    }
    async range(start: number, end: number) {
      calls.push({
        table: this.table,
        columns: this.columns,
        filters: this.filters,
        start,
        end,
      });
      const rows = (tables[this.table] || []).filter(
        (r) =>
          this.filters.every((f) => f.values.includes(r[f.key])) &&
          (!this.since || String(r[this.since.key]) >= this.since.value),
      );
      return {
        data: rows.slice(start, Math.min(end + 1, start + cap)),
        count: missingCount ? null : rows.length,
        error: null,
      };
    }
  }
  return {
    client: {
      from: (table: string) => new Query(table),
    } as unknown as SupabaseClient,
    calls,
  };
}
function fixture(count = 1) {
  const { data } = pipelineModuleDemo(),
    seed = {
      ...data.opportunities[0],
      funded_at: null,
      funded_amount: null,
      closer_id: data.profile.id,
      seller_id: data.profile.id,
    };
  const opportunities = Array.from({ length: count }, (_, i) => ({
    ...seed,
    id: "case-" + i,
    company: "Fixture " + i,
  }));
  const tasks = opportunities.map((o, i) => ({
    id: "task-" + i,
    opportunity_id: o.id,
    owner_id: data.profile.id,
    title: "Fixture task",
    status: "open",
    area: "seller",
    due_at: "2026-11-14T12:00:00Z",
  }));
  return {
    data,
    opportunities,
    tables: {
      opportunity_workspace: opportunities,
      profiles: data.profiles,
      mail_accounts: [],
      lenders: [],
      tasks,
      offers: [],
      submissions: [],
      financing_processes: [],
      documents: [],
      case_events: [],
      mail_conversations_visible: [],
      messages: [],
      lead_workspace: [],
      mail_archive_visible: [],
      pipeline_mail_reviews: [],
    } as unknown as Record<string, Row[]>,
  };
}
test("Master superadmin pages authorized archive metadata directly without encrypted content", async () => {
  const f = fixture(),
    account = "fixture-account";
  f.tables.mail_accounts = [
    { id: account, email: "rep@fixture.example", owner_id: f.data.profile.id },
  ];
  f.tables.gmail_archive_messages = Array.from({ length: 3 }, (_, i) => ({
    id: "archive-" + i,
    account_id: account,
    gmail_thread_id: "thread-" + i,
    subject: "Fixture metadata",
    sent_at: "2026-11-14T12:00:00Z",
    direction: "inbound",
    nature: "personal",
    reply_intent: null,
    participants: [],
  }));
  const db = database(f.tables, 2);
  const b = await readMasterPipeline(
    db.client,
    f.data.profile,
    parseMasterQuery(new URLSearchParams("tab=comms")),
    Date.parse("2026-11-15T18:00:00Z"),
  );
  assert.equal(b.total, 3);
  assert.equal(b.byRep.find((r) => r.id === f.data.profile.id)?.emails, 3);
  const reads = db.calls.filter((c) => c.table === "gmail_archive_messages");
  assert.equal(reads.length, 2);
  assert.deepEqual(
    reads.map((r) => r.start),
    [0, 2],
  );
  assert(
    reads.every(
      (r) =>
        r.end - r.start === 999 && !r.columns.includes("encrypted_payload"),
    ),
  );
  assert(!db.calls.some((c) => c.table === "mail_archive_visible"));
});
test("Master reader follows a smaller REST cap and aggregates all73 cases before paging", async () => {
  const f = fixture(73),
    db = database(f.tables, 2),
    q = parseMasterQuery(new URLSearchParams("tab=tasks&page=1"));
  const b = await readMasterPipeline(
    db.client,
    f.data.profile,
    q,
    Date.parse("2026-11-15T18:00:00Z"),
  );
  assert.equal(b.total, 73);
  assert.equal(b.rows.length, 23);
  assert.equal(b.byRep.find((r) => r.id === f.data.profile.id)?.tasks, 73);
  assert(
    db.calls.filter((c) => c.table === "opportunity_workspace").length > 1,
  );
  assert(db.calls.every((c) => !c.columns.includes("encrypted_payload")));
  assert(
    db.calls
      .filter((c) => c.filters.length)
      .every((c) => c.filters.every((f) => f.values.length <= 50)),
  );
});
test("Master seller reads exclude financial IDs and bodies outside the visible page", async () => {
  const f = fixture();
  f.data.profile = { ...f.data.profile, role: "seller" };
  f.tables.opportunity_workspace.push({
    ...f.opportunities[0],
    id: "foreign",
    seller_id: "other",
    company: "Foreign fixture",
  });
  f.tables.mail_conversations_visible = [
    {
      id: "conv",
      opportunity_id: "case-0",
      submission_id: null,
      account_id: "account",
      area: "seller",
      subject: "Fixture subject",
    },
  ];
  f.tables.messages = [
    {
      id: "message",
      conversation_id: "conv",
      direction: "inbound",
      sender: f.opportunities[0].email,
      sent_at: "2026-11-14T12:00:00Z",
      status: "received",
      area: "seller",
      nature: "personal",
      body: "Fixture content\n> Quoted content",
    },
  ];
  const db = database(f.tables),
    q = parseMasterQuery(new URLSearchParams("tab=comms"));
  const b = await readMasterPipeline(
    db.client,
    f.data.profile,
    q,
    Date.parse("2026-11-15T18:00:00Z"),
  );
  assert.equal(b.rows[0].excerpt, "Fixture content");
  assert(!JSON.stringify(b).includes("Foreign fixture"));
  for (const name of [
    "offers",
    "submissions",
    "financing_processes",
    "pipeline_mail_reviews",
  ])
    assert(!db.calls.some((c) => c.table === name));
  assert(!db.calls.some((c) => c.table === "gmail_archive_messages"));
  assert(db.calls.some((c) => c.table === "mail_archive_visible"));
  assert(
    db.calls
      .filter((c) => c.table === "messages" && c.columns === "id,body")
      .every((c) => c.filters[0].values.length <= 50),
  );
  assert(
    db.calls
      .filter((c) => c.table === "messages" && c.columns !== "id,body")
      .every((c) => !c.columns.split(",").includes("body")),
  );
});
test("Master unapproved review results cannot prove an offer reply", async () => {
  const f = fixture(),
    o = f.opportunities[0];
  f.tables.submissions = [
    { id: "sub", opportunity_id: o.id, lender_id: "l", status: "offer" },
  ];
  f.tables.offers = [
    {
      id: "offer",
      opportunity_id: o.id,
      submission_id: "sub",
      amount: 50000,
      status: "received",
      expires_at: null,
      created_at: "2026-11-13T12:00:00Z",
    },
  ];
  f.tables.mail_conversations_visible = [
    {
      id: "c",
      opportunity_id: o.id,
      submission_id: "sub",
      account_id: "a",
      area: "closer",
      subject: "Fixture",
    },
  ];
  f.tables.messages = [
    {
      id: "m",
      conversation_id: "c",
      direction: "inbound",
      status: "received",
      area: "closer",
      sent_at: "2026-11-13T12:00:00Z",
      sender: "lender@fixture.example",
      body: "Synthetic offer body",
    },
  ];
  const review = {
    id: "r",
    opportunity_id: o.id,
    message_id: "m",
    status: "pending",
    result: { offer_id: "offer" },
  };
  f.tables.pipeline_mail_reviews = [review];
  const q = parseMasterQuery(new URLSearchParams("tab=offers"));
  let b = await readMasterPipeline(
    database(f.tables).client,
    f.data.profile,
    q,
    Date.parse("2026-11-15T18:00:00Z"),
  );
  assert.equal(b.rows[0].best?.answered, null);
  review.status = "approved";
  b = await readMasterPipeline(
    database(f.tables).client,
    f.data.profile,
    q,
    Date.parse("2026-11-15T18:00:00Z"),
  );
  assert.equal(b.rows[0].best?.answered, false);
});
test("Master incomplete catalog metadata fails closed instead of reporting a false zero", async () => {
  const f = fixture(),
    db = database(f.tables, 500, true);
  await assert.rejects(
    readMasterPipeline(
      db.client,
      f.data.profile,
      parseMasterQuery(new URLSearchParams()),
    ),
    /Catalog count unavailable/,
  );
});
