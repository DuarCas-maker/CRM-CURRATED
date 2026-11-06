import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { demoWorkspace } from "../src/lib/demo";
import {
  elapsedSend,
  summarizeOpportunities,
  type SignalMessage,
} from "../src/lib/opportunity-signals";
import { loadOpportunitySignals } from "../src/lib/server/opportunity-signals";

const cssHook = registerHooks({
  load(url, context, nextLoad) {
    return url.endsWith(".css")
      ? { format: "module", source: "", shortCircuit: true }
      : nextLoad(url, context);
  },
});
const { OpportunitySignalSummary } =
  await import("../src/components/opportunity-signals");
cssHook.deregister();

test("the summary renders separate send dates, stored files and distinct lenders in both languages", () => {
  for (const locale of ["es", "en"] as const) {
    const html = renderToStaticMarkup(
      createElement(OpportunitySignalSummary, {
        locale,
        signals: {
          lastClientSentAt: "2026-10-20T12:00:00Z",
          lastLenderSentAt: null,
          documentCount: 3,
          lenderCount: 2,
        },
      }),
    );
    assert.match(html, /datetime="2026-10-20T12:00:00Z"/i);
    assert.match(html, /has-documents/);
    assert.match(html, /<strong>2<\/strong>/);
    assert.match(html, locale === "es" ? /3 cargados/ : /3 uploaded/);
    assert.match(html, locale === "es" ? /Sin envíos/ : /No sends/);
  }
});

function fixture() {
  const data = demoWorkspace();
  const opportunity = data.opportunities[0];
  data.conversations = [
    {
      ...data.conversations[0],
      id: "mixed",
      opportunity_id: opportunity.id,
      submission_id: null,
    },
  ];
  data.documents = [];
  data.submissions = [];
  data.messages = [];
  data.lenders = [
    {
      id: "lender",
      name: "Fixture lender",
      email: "deals@lender.example",
      products: [],
      channel: "email",
      notes: "",
    },
  ];
  data.lender_contacts = [];
  return { data, opportunity };
}
function message(
  to: string[],
  day = 10,
  extra: Partial<SignalMessage> = {},
): SignalMessage {
  return {
    conversation_id: "mixed",
    direction: "outbound",
    status: "sent",
    sent_at: `2026-10-${day}T12:00:00Z`,
    participants: to.map((email) => ({ role: "to", email })),
    ...extra,
  };
}

test("last sends use each opportunity's confirmed outbound recipients, including mixed broadcasts", () => {
  const { data, opportunity: o } = fixture();
  const messages = [
    message([o.email], 10),
    message(["deals@lender.example"], 11),
    message([o.email, "analyst@lender.example"], 12),
    message([o.email], 15, { direction: "inbound", status: "received" }),
    ...["queued", "failed", "uncertain", "draft"].map((status) =>
      message([o.email], 16, { status }),
    ),
    message([data.accounts[0].email], 17),
    message(["unrelated@example.test"], 18),
    message([o.email], 19, { conversation_id: "other-case" }),
    message([o.email], 20, { sent_at: "invalid" }),
  ];
  const result = summarizeOpportunities([o], { ...data, messages })[o.id];
  assert.deepEqual(result, {
    lastClientSentAt: "2026-10-12T12:00:00Z",
    lastLenderSentAt: "2026-10-12T12:00:00Z",
    documentCount: 0,
    lenderCount: 1,
  });
});

test("documents require stored files and lender totals deduplicate submissions and messages, excluding drafts", () => {
  const { data, opportunity: o } = fixture();
  const result = summarizeOpportunities([o], {
    ...data,
    documents: [
      { opportunity_id: o.id },
      { opportunity_id: o.id, storage_path: "fixture.pdf" },
      { opportunity_id: "elsewhere", storage_path: "other.pdf" },
    ],
    submissions: [
      {
        id: "s1",
        opportunity_id: o.id,
        lender_id: "lender",
        status: "submitted",
      },
      {
        id: "s2",
        opportunity_id: o.id,
        lender_id: "lender",
        status: "reviewing",
      },
      { id: "s3", opportunity_id: o.id, lender_id: "portal", status: "offer" },
      { id: "s4", opportunity_id: o.id, lender_id: "draft", status: "draft" },
    ],
    messages: [message(["deals@lender.example"])],
  })[o.id];
  assert.equal(result.documentCount, 1);
  assert.equal(result.lenderCount, 2);
  assert.equal(result.lastClientSentAt, null);
});

test("legacy conversations use submission or recipient evidence and explicit client messages override a lender thread", () => {
  const { data, opportunity: o } = fixture();
  const submission = {
    id: "s1",
    opportunity_id: o.id,
    lender_id: "lender",
    status: "draft",
  };
  const result = summarizeOpportunities([o], {
    ...data,
    submissions: [submission],
    conversations: [{ ...data.conversations[0], submission_id: "s1" }],
    messages: [message([], 10), message([o.email], 11)],
  })[o.id];
  assert.equal(result.lastLenderSentAt, "2026-10-10T12:00:00Z");
  assert.equal(result.lastClientSentAt, "2026-10-11T12:00:00Z");
  assert.equal(result.lenderCount, 1);
});

test("elapsed times cover minutes, hours, days and clock skew in both locales", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(
    elapsedSend("2026-10-20T11:58:00Z", "es", now),
    "hace 2 minutos",
  );
  assert.equal(elapsedSend("2026-10-20T10:00:00Z", "en", now), "2 hours ago");
  assert.equal(elapsedSend("2026-10-17T12:00:00Z", "es", now), "hace 3 días");
  assert.equal(elapsedSend("2026-10-21T12:00:00Z", "en", now), "Just now");
});

test("server metadata pages beyond the inbox limit, scopes requests, and surfaces permission errors", async () => {
  const { data, opportunity: o } = fixture();
  const requested: URL[] = [];
  const db = createClient("https://signals.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requested.push(url);
        assert(!url.searchParams.get("select")?.includes("body"));
        const table = url.pathname.split("/").pop();
        if (table === "mail_conversations_visible") {
          assert.equal(url.searchParams.get("opportunity_id"), `in.(${o.id})`);
          return Response.json(data.conversations);
        }
        if (table !== "messages") return Response.json([]);
        assert.equal(url.searchParams.get("conversation_id"), "in.(mixed)");
        assert.equal(url.searchParams.get("status"), "eq.sent");
        assert.equal(url.searchParams.get("direction"), "eq.outbound");
        const offset = Number(url.searchParams.get("offset"));
        return Response.json(
          offset === 0
            ? Array.from({ length: 1000 }, () =>
                message(["deals@lender.example"], 10),
              )
            : [message([o.email], 11)],
        );
      },
    },
  });
  const result = await loadOpportunitySignals(db, [o], data);
  assert.equal(result[o.id].lastClientSentAt, "2026-10-11T12:00:00Z");
  assert.equal(
    requested.filter((url) => url.pathname.endsWith("/messages")).length,
    2,
  );
  assert.deepEqual(await loadOpportunitySignals(db, [], data), {});
  const denied = createClient("https://signals.test", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: async () =>
        Response.json(
          { code: "42501", message: "Permission denied" },
          { status: 403 },
        ),
    },
  });
  await assert.rejects(
    loadOpportunitySignals(denied, [o], data),
    /Permission denied/,
  );
});
