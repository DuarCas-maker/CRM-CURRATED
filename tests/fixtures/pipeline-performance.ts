import type { SupabaseClient } from "@supabase/supabase-js";
import { pipelineModuleDemo } from "../../src/lib/pipeline-os/demo";

type Row = Record<string, unknown>;
export function pipelinePerformanceFixture(
  options: {
    count?: number;
    cap?: number;
    delay?: number;
    failTable?: string;
  } = {},
) {
  const { data } = pipelineModuleDemo();
  const count = options.count ?? 351,
    cap = options.cap ?? 500;
  const opportunities = Array.from({ length: count }, (_, i) => ({
    ...data.opportunities[0],
    id: `case-${i}`,
    company: `Fixture ${i}`,
    email: `client-${i}@fixture.test`,
    contact_id: `contact-${i}`,
    seller_id: data.profile.id,
    closer_id: data.profile.id,
    stage: "application_pending",
    application_complete: false,
    funded_at: null,
    funded_amount: null,
  }));
  const tables: Record<string, Row[]> = {
    opportunity_workspace: opportunities,
    profiles: data.profiles.map((p) => ({ ...p })),
    mail_conversations_visible: opportunities.map((o) => ({
      id: `conv-${o.id}`,
      opportunity_id: o.id,
      area: "seller",
      submission_id: null,
      recipient_email: o.email,
      process_id: null,
      subject: "Fixture conversation",
      needs_attention: false,
      updated_at: "2026-11-18T12:00:00Z",
    })),
    messages: opportunities.map((o) => ({
      id: `msg-${o.id}`,
      conversation_id: `conv-${o.id}`,
      direction: "outbound",
      status: "sent",
      area: "seller",
      sender: "rep@fixture.test",
      sent_at: "2026-11-18T12:00:00Z",
      participants: [{ email: o.email, type: "to" }],
      nature: "personal",
      body: "Fixture content",
    })),
    lead_workspace: opportunities.map((o, i) => ({
      id: `lead-${i}`,
      contact_id: o.contact_id,
      opportunity_id: o.id,
      company: o.company,
      contact: "Fixture",
      email: o.email,
      seller_id: o.seller_id,
      verification: "valid",
      suppressed: false,
      created_at: "2026-11-18T12:00:00Z",
    })),
    tasks: opportunities.map((o, i) => ({
      id: `task-${i}`,
      opportunity_id: o.id,
      owner_id: data.profile.id,
      title: "Fixture task",
      area: "seller",
      status: "open",
      due_at: "2026-11-18T12:00:00Z",
    })),
  };
  let active = 0,
    peak = 0;
  const perTable = new Map<string, { active: number; peak: number }>();
  const calls: {
    table: string;
    columns: string;
    offset: number;
    batch?: unknown[];
    exact: boolean;
  }[] = [];
  async function request<T>(table: string, run: () => T): Promise<T> {
    const metric = perTable.get(table) ?? { active: 0, peak: 0 };
    metric.peak = Math.max(metric.peak, ++metric.active);
    perTable.set(table, metric);
    peak = Math.max(peak, ++active);
    try {
      await new Promise((r) => setTimeout(r, options.delay ?? 2));
      return run();
    } finally {
      active--;
      metric.active--;
    }
  }
  class Query {
    columns = "";
    exact = false;
    batch?: unknown[];
    predicates: ((row: Row) => boolean)[] = [];
    constructor(readonly table: string) {}
    select(columns: string, options?: { count?: string }) {
      this.columns = columns;
      this.exact = options?.count === "exact";
      return this;
    }
    order() {
      return this;
    }
    is() {
      return this;
    }
    in(key: string, values: unknown[]) {
      this.batch = values;
      this.predicates.push((r) => values.includes(r[key]));
      return this;
    }
    eq(key: string, value: unknown) {
      this.predicates.push((r) => r[key] === value);
      return this;
    }
    gte(key: string, value: string) {
      this.predicates.push((r) => String(r[key]) >= value);
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
      return request(this.table, () => {
        if (this.table === options.failTable)
          return {
            data: null,
            count: null,
            error: { code: "42501", message: "Fixture permission denied" },
          };
        const rows = (tables[this.table] ?? []).filter((r) =>
          this.predicates.every((p) => p(r)),
        );
        return {
          data: rows.slice(offset, Math.min(end + 1, offset + cap)),
          count: rows.length,
          error: null,
        };
      });
    }
  }
  const client = {
    from: (table: string) => new Query(table),
    rpc: async (name: string) => {
      if (name !== "campaign_flow_cases")
        throw new Error("Unexpected fixture RPC");
      calls.push({
        table: "rpc:" + name,
        columns: "case_ids",
        offset: 0,
        exact: false,
      });
      return request("rpc:" + name, () => ({ data: [], error: null }));
    },
  } as unknown as SupabaseClient;
  return {
    client,
    profile: data.profile,
    tables,
    calls,
    metrics: () => ({
      peak,
      active,
      calls: calls.length,
      byTable: Object.fromEntries([...perTable].map(([k, v]) => [k, v.peak])),
    }),
  };
}
