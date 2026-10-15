import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadWorkspaceMail } from "../src/lib/server/workspace-mail";

const uuid = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const filterIds = (url: URL, column: string) =>
  url.searchParams.get(column)!.slice(4, -1).split(",");

test("large workspaces keep request URLs short and select the newest 1000 messages across every batch", async () => {
  const conversations = Array.from({ length: 3000 }, (_, i) => uuid(i));
  const requests: URL[] = [];
  const db = createClient("https://workspace.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        // Reproduce the proxy rejection from production for oversized filters.
        if (url.href.length > 8000)
          return new Response("URI too long", { status: 400 });
        assert(url.href.length < 3000);
        if (url.pathname.endsWith("/messages")) {
          assert.equal(url.searchParams.get("order"), "sent_at.desc,id.desc");
          return Response.json(
            filterIds(url, "conversation_id")
              .map((id) => ({
                id,
                conversation_id: id,
                sent_at: new Date(Number(id.slice(-12)) * 1000).toISOString(),
              }))
              .reverse(),
          );
        }
        assert(url.pathname.endsWith("/message_attachments"));
        return Response.json(
          filterIds(url, "message_id").map((id) => ({
            id: `attachment-${id}`,
            message_id: id,
          })),
        );
      },
    },
  });
  const result = await loadWorkspaceMail(db, [
    ...conversations,
    conversations[0],
  ]);
  assert.equal(result.messages.length, 1000);
  assert.deepEqual(
    result.messages.map((m) => m.id),
    conversations.slice(2000).reverse(),
  );
  assert.equal(result.attachments.length, 1000);
  assert.deepEqual(
    new Set(result.attachments.map((a) => a.message_id)),
    new Set(result.messages.map((m) => m.id)),
  );
  assert.equal(
    requests.filter((u) => u.pathname.endsWith("/messages")).length,
    60,
  );
  assert.equal(
    requests.filter((u) => u.pathname.endsWith("/message_attachments")).length,
    20,
  );
});

test("an empty workspace sends no mail queries and batch failures are not concealed", async () => {
  let calls = 0;
  const db = createClient("https://workspace.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async () => {
        calls++;
        return Response.json(
          { code: "42501", message: "Permission denied" },
          { status: 403 },
        );
      },
    },
  });
  assert.deepEqual(await loadWorkspaceMail(db, []), {
    messages: [],
    attachments: [],
  });
  assert.equal(calls, 0);
  await assert.rejects(loadWorkspaceMail(db, [uuid(1)]), /Permission denied/);
  assert.equal(calls, 1);
});

test("attachment batches share one global limit and identical message dates have deterministic order", async () => {
  const ids = Array.from({ length: 100 }, (_, i) => uuid(i));
  let attachmentCalls = 0;
  const db = createClient("https://workspace.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/messages"))
          return Response.json(
            filterIds(url, "conversation_id").map((id) => ({
              id,
              sent_at: "2026-10-14T00:00:00Z",
            })),
          );
        attachmentCalls++;
        const message = filterIds(url, "message_id")[0];
        return Response.json(
          Array.from(
            { length: Number(url.searchParams.get("limit")) },
            (_, i) => ({ id: uuid(i), message_id: message }),
          ),
        );
      },
    },
  });
  const result = await loadWorkspaceMail(db, ids);
  assert.deepEqual(
    result.messages.map((m) => m.id),
    [...ids].reverse(),
  );
  assert.equal(result.attachments.length, 1000);
  assert.equal(attachmentCalls, 1);
});
