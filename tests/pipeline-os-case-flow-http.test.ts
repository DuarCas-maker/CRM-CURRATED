import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCaseFlowHandlers } from "../src/lib/server/case-flow";
import { HttpError } from "../src/lib/server/supabase";
import { demoWorkspace } from "../src/lib/demo";

const caseId = randomUUID();
const command = {
  operation: "confirmation",
  request_key: randomUUID(),
  process_id: null,
  expected_event_id: null,
  milestone: "sources",
  decision: "confirmed",
  reason: "Confirmación ficticia",
  archive_message_id: null,
  document_id: randomUUID(),
};
function post(body: unknown) {
  return new Request("https://example.invalid/api/pipeline-os/case-flow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
test("AC07: origin, active/MFA auth and schema validation precede RPC; failures remain private/no-store", async () => {
  let writes = 0,
    origins = 0;
  const db = {
    rpc: async (name: string, args: unknown) => {
      writes++;
      assert.equal(name, "case_flow_command");
      assert.deepEqual(args, { case_id: caseId, p: command });
      return { data: { event_id: randomUUID() }, error: null };
    },
  } as unknown as SupabaseClient;
  const profile = demoWorkspace().profile;
  const handlers = createCaseFlowHandlers({
    user: async () => ({ db, profile }),
    origin: () => {
      origins++;
    },
  });
  for (const input of [
    "{",
    { case_id: "bad", command },
    { case_id: caseId, command: { ...command, document_id: null } },
    { case_id: caseId, command, extra: true },
  ]) {
    const r = await handlers.POST(post(input));
    assert.equal(r.status, 400);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(writes, 0);
  const r = await handlers.POST(post({ case_id: caseId, command }));
  assert.equal(r.status, 200);
  assert.equal(writes, 1);
  assert.equal(origins, 5);
  for (const status of [401, 403]) {
    const denied = createCaseFlowHandlers({
      user: async () => {
        throw new HttpError(status, "Acceso no disponible");
      },
      origin: () => {},
    });
    const failed = await denied.POST(post({ case_id: caseId, command }));
    assert.equal(failed.status, status);
    assert.equal(failed.headers.get("cache-control"), "private, no-store");
  }
  const deniedOrigin = createCaseFlowHandlers({
    user: async () => {
      throw Error("Must not authenticate");
    },
    origin: () => {
      throw new HttpError(403, "Origin required");
    },
  });
  assert.equal(
    (await deniedOrigin.POST(post({ case_id: caseId, command }))).status,
    403,
  );
});

test("AC07: missing schema, version conflicts and access failures never expose raw database content", async () => {
  const profile = demoWorkspace().profile;
  for (const [code, message, status] of [
    ["PGRST202", "internal-schema-detail", 503],
    ["P0001", "Flow changed; refresh before saving", 409],
    ["P0001", "Case flow access denied", 403],
    ["23505", "private-row-content", 409],
  ] as const) {
    const db = {
      rpc: async () => ({ data: null, error: { code, message } }),
    } as unknown as SupabaseClient;
    const h = createCaseFlowHandlers({
      user: async () => ({ db, profile }),
      origin: () => {},
    });
    const r = await h.POST(post({ case_id: caseId, command }));
    assert.equal(r.status, status);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    if (message.includes("private") || message.includes("internal"))
      assert.ok(!(await r.text()).includes(message));
  }
});

test("AC07: GET validates IDs before reads and checks case visibility before financial metadata", async () => {
  const calls: string[] = [],
    profile = { ...demoWorkspace().profile, role: "seller" as const };
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    maybeSingle: async () => ({
      data: { id: caseId, seller_id: "other", closer_id: null },
      error: null,
    }),
  };
  const db = {
    from: (table: string) => {
      calls.push(table);
      return query;
    },
  } as unknown as SupabaseClient;
  const h = createCaseFlowHandlers({
    user: async () => ({ db, profile }),
    origin: () => {},
  });
  assert.equal(
    (
      await h.GET(
        new Request(
          "https://example.invalid/api/pipeline-os/case-flow?case=bad",
        ),
      )
    ).status,
    400,
  );
  assert.deepEqual(calls, []);
  const r = await h.GET(
    new Request(
      `https://example.invalid/api/pipeline-os/case-flow?case=${caseId}`,
    ),
  );
  assert.equal(r.status, 404);
  assert.deepEqual(calls, ["opportunity_workspace"]);
});
