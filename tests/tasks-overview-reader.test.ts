import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readTasksOverview } from "../src/lib/server/pipeline-tasks";
import { parseTaskOverviewQuery } from "../src/lib/pipeline-os/tasks-overview";
import { pipelineModuleDemo } from "../src/lib/pipeline-os/demo";
import { tasksOverviewFixture } from "./fixtures/tasks-overview";

type Row = Record<string, unknown>;
function fixtureDatabase(missingCount = false) {
  const source = tasksOverviewFixture();
  const { data } = pipelineModuleDemo();
  const seed = data.opportunities[0];
  const tables: Record<string, Row[]> = {
    profiles: source.profiles.map((p) => ({ ...p })),
    mail_accounts: source.accounts,
    campaigns: source.campaigns,
    campaign_group_members: source.campaigns.map((c) => ({
      campaign_id: c.id,
    })),
    lead_workspace: source.leads,
    opportunity_workspace: source.leads.map((l) => ({
      ...seed,
      id: l.opportunity_id,
      contact: l.contact,
      company: l.company,
      email: l.email,
      seller_id: l.seller_id,
      closer_id: null,
      stage: "application_pending",
      funded_at: null,
      funded_amount: null,
    })),
    mail_conversations_visible: source.conversations,
    messages: source.messages,
  };
  const calls: {
    table: string;
    columns: string;
    offset: number;
    batch?: unknown[];
    exact: boolean;
  }[] = [];
  class Query {
    columns = "";
    exact = false;
    predicates: ((r: Row) => boolean)[] = [];
    batch?: unknown[];
    constructor(
      readonly table: string,
      readonly args?: { campaign: string },
    ) {}
    select(columns: string, options: { count?: string }) {
      this.columns = columns;
      this.exact = options?.count === "exact";
      return this;
    }
    order() {
      return this;
    }
    eq(key: string, value: unknown) {
      this.predicates.push((r) => r[key] === value);
      return this;
    }
    in(key: string, values: unknown[]) {
      this.batch = values;
      this.predicates.push((r) => values.includes(r[key]));
      return this;
    }
    is() {
      return this;
    }
    async range(offset: number, end: number) {
      calls.push({
        table: this.table,
        columns: this.columns,
        offset,
        batch: this.batch,
        exact: this.exact,
      });
      const sourceRows: Row[] = this.args
        ? [
            ...new Map(
              source.facts
                .filter((f) => f.campaignId === this.args!.campaign)
                .map((f) => [f.contact_id, { ...f }]),
            ).values(),
          ]
        : tables[this.table] || [];
      const rows = sourceRows.filter((r) => this.predicates.every((p) => p(r)));
      return {
        data: rows.slice(offset, Math.min(end + 1, offset + 17)),
        count: missingCount ? null : rows.length,
        error: null,
      };
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    rpc: (
      name: string,
      args: { campaign: string },
      options?: { count?: string },
    ) => {
      if (name === "campaign_flow_cases") {
        calls.push({
          table: "rpc:campaign_flow_cases",
          columns: "case_ids",
          offset: 0,
          exact: false,
        });
        return Promise.resolve({ data: [], error: null });
      }
      const q = new Query("rpc:" + name, args);
      q.exact = options?.count === "exact";
      return q;
    },
  } as unknown as SupabaseClient;
  return { source, calls, tables, client };
}

test("task reader reads complete catalogs and Campaign Control contact facts with bounded metadata pages", async () => {
  const f = fixtureDatabase();
  const result = await readTasksOverview(
    f.client,
    f.source.profile,
    parseTaskOverviewQuery(new URLSearchParams("owner=santino&status=managed")),
  );
  assert.equal(result.totals.sent, 2);
  assert.equal(result.totals.leads, 73);
  assert.equal(result.total, 2);
  assert.equal(result.totals.stages.app, 73);
  assert(!f.calls.some((c) => c.table === "campaign_workspace"));
  assert(f.calls.some((c) => c.table === "lead_workspace" && c.offset === 17));
  assert(
    f.calls
      .filter((c) => c.table === "rpc:campaign_contact_facts")
      .every((c) => c.exact),
  );
  assert(
    f.calls.every(
      (c) => !/body|encrypted|credential|token|\*/i.test(c.columns),
    ),
  );
  assert(f.calls.filter((c) => c.batch).every((c) => c.batch!.length <= 50));
});

test("task reader only counts campaigns belonging to visible campaign groups", async () => {
  const f = fixtureDatabase();
  f.tables.campaign_group_members = [
    { campaign_id: "campaign-a" },
    { campaign_id: "campaign-b" },
  ];
  const result = await readTasksOverview(
    f.client,
    f.source.profile,
    parseTaskOverviewQuery(new URLSearchParams()),
  );
  assert.equal(
    result.totals.sent,
    1,
    "the same contact in two senders remains one sent lead",
  );
  assert.equal(result.byRep.find((r) => r.id === "samuel")?.sent, 0);
});

test("task reader reports incomplete catalogs and never requests campaign/lead facts for closers", async () => {
  const missing = fixtureDatabase(true);
  await assert.rejects(
    () =>
      readTasksOverview(
        missing.client,
        missing.source.profile,
        parseTaskOverviewQuery(new URLSearchParams()),
      ),
    /unavailable/,
  );
  const f = fixtureDatabase();
  const closer = { ...f.source.profiles[1], role: "closer" as const };
  f.tables.opportunity_workspace.forEach((o) => {
    o.closer_id = closer.id;
    o.handed_off_at = "2026-11-01T00:00:00Z";
  });
  const result = await readTasksOverview(
    f.client,
    closer,
    parseTaskOverviewQuery(new URLSearchParams()),
  );
  assert.equal(result.totals.sent, null);
  assert(
    !f.calls.some(
      (c) =>
        c.table === "campaigns" ||
        c.table === "campaign_group_members" ||
        c.table === "lead_workspace" ||
        c.table === "rpc:campaign_contact_facts",
    ),
  );
  const seller = { ...f.source.profiles[1], role: "seller" as const };
  const visible = await readTasksOverview(
    f.client,
    seller,
    parseTaskOverviewQuery(new URLSearchParams("owner=samuel")),
  );
  assert.equal(visible.total, 0);
  assert(visible.byRep.every((r) => r.id === seller.id));
});
