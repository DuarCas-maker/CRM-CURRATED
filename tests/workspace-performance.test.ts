import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readWorkspace } from "../src/lib/server/workspace";
import { demoWorkspace } from "../src/lib/demo";

const caseId = "00000000-0000-4000-8000-000000000001";
const seed = demoWorkspace();
const opportunity = {
  ...seed.opportunities[0],
  id: caseId,
  handed_off_at: null,
};
function fixture(
  options: {
    empty?: boolean;
    deny?: string;
    cases?: number;
    ready?: boolean;
    missingControl?: boolean;
  } = {},
) {
  const calls: URL[] = [],
    events: string[] = [];
  let activeAccess = 0,
    peakAccess = 0;
  const db = createClient("https://workspace.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input)),
          table = url.pathname.split("/").at(-1)!;
        calls.push(url);
        events.push(table + ":start");
        if (table === "mail_access_context")
          peakAccess = Math.max(peakAccess, ++activeAccess);
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (table === "mail_access_context") activeAccess--;
        events.push(table + ":end");
        if (options.deny === table)
          return Response.json(
            { code: "42501", message: "Permission denied" },
            { status: 403 },
          );
        if (options.missingControl && table === "financing_control_dashboard")
          return Response.json(
            { code: "PGRST202", message: "Function unavailable" },
            { status: 404 },
          );
        const rows = options.empty
          ? []
          : Array.from({ length: options.cases || 1 }, (_, i) => ({
              ...opportunity,
              id: i
                ? `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`
                : caseId,
            }));
        let result: unknown = [];
        if (
          table === "operational_settings" ||
          table === "notification_preferences"
        )
          result = null;
        if (options.ready && table === "operational_settings")
          result = { id: 1 };
        if (table === "financing_control_dashboard") result = { rows: [] };
        if (table === "operational_dashboard") result = { fixture: true };
        if (table === "opportunity_workspace" || table === "opportunity_tasks")
          result = rows;
        if (table === "workspace_stats") result = { total: rows.length };
        if (table === "mail_access_context")
          result = { area: "seller", can_write: false };
        if (table === "lead_preparation_overview")
          result = { counts: {}, verification_total: 0, imports_total: 0 };
        return Response.json(result, {
          headers: {
            "Content-Range": `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
          },
        });
      },
    },
  });
  return { db, calls, events, peakAccess: () => peakAccess };
}

test("workspace overlaps independent reads, preserves filters and uses the supplied signed-in client", async () => {
  const f = fixture();
  const data = await readWorkspace(
    f.db,
    seed.profile,
    new URLSearchParams({ view: "tasks", case: caseId }),
  );
  assert.equal(data.opportunities[0].id, caseId);
  assert.deepEqual(data.mail_access?.[caseId], {
    area: "seller",
    can_write: false,
  });
  assert(
    f.events.indexOf("workspace_stats:start") <
      f.events.indexOf("operational_settings:end"),
  );
  assert(
    f.events.indexOf("notification_preferences:start") <
      f.events.indexOf("workspace_stats:end"),
  );
  const cases = f.calls.find((u) =>
    u.pathname.endsWith("/opportunity_workspace"),
  )!;
  assert.equal(cases.searchParams.get("id"), "eq." + caseId);
  assert.equal(cases.searchParams.get("archived_at"), "is.null");
  assert.equal(cases.searchParams.get("limit"), "100");
  const tasks = f.calls.find((u) => u.pathname.endsWith("/tasks"))!;
  assert.equal(tasks.searchParams.get("opportunity_id"), `in.(${caseId})`);
  assert(!f.calls.some((u) => u.pathname.includes("/auth/")));
});

test("the initial overview retains dashboards and the existing optional-migration fallback", async () => {
  for (const missingControl of [false, true]) {
    const f = fixture({ ready: true, missingControl });
    const data = await readWorkspace(f.db, seed.profile);
    assert.equal(data.crm_extensions_ready, true);
    assert.deepEqual(
      data.financing_control,
      missingControl ? undefined : { rows: [] },
    );
    assert.deepEqual(data.operational, { fixture: true });
    assert.equal(
      f.calls.filter((u) => u.pathname.endsWith("/financing_control_dashboard"))
        .length,
      1,
    );
  }
  const denied = fixture({ ready: true, deny: "financing_control_dashboard" });
  await assert.rejects(
    readWorkspace(denied.db, seed.profile),
    /Permission denied/,
  );
});

test("empty lists and lead preparation do not read unrelated cases, mail or empty relations", async () => {
  for (const view of ["pipeline", "leads"]) {
    const f = fixture({ empty: true });
    const data = await readWorkspace(
      f.db,
      seed.profile,
      new URLSearchParams({ view }),
    );
    assert.deepEqual(data.opportunities, []);
    assert.deepEqual(data.mail_access, {});
    for (const table of [
      "tasks",
      "activities",
      "documents",
      "analyses",
      "submissions",
      "offers",
      "mail_conversations_visible",
      "messages",
      "message_attachments",
      "mail_access_context",
    ])
      assert(!f.calls.some((u) => u.pathname.endsWith("/" + table)), table);
    if (view === "leads")
      assert(
        !f.calls.some((u) => u.pathname.endsWith("/opportunity_workspace")),
      );
  }
});

test("workspace overlaps directories with existing permission reads and surfaces database failures", async () => {
  const f = fixture({ cases: 17 });
  const data = await readWorkspace(
    f.db,
    seed.profile,
    new URLSearchParams({ view: "tasks" }),
  );
  assert.equal(Object.keys(data.mail_access || {}).length, 17);
  assert(f.peakAccess() > 1);
  assert(
    f.events.indexOf("lenders:start") <
      f.events.indexOf("mail_access_context:end"),
  );
  for (const table of [
    "workspace_stats",
    "notification_preferences",
    "tasks",
    "lenders",
    "mail_access_context",
  ]) {
    const denied = fixture({ deny: table });
    await assert.rejects(
      readWorkspace(
        denied.db,
        seed.profile,
        new URLSearchParams({ view: "tasks" }),
      ),
      table === "mail_access_context"
        ? /Mail access contract/
        : /Permission denied/,
    );
  }
});
