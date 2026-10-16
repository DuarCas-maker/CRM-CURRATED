import test from "node:test";
import assert from "node:assert/strict";
import { replyIntent, MAIL_ENGAGEMENT_START } from "../src/lib/mail-interest";
import { snapshotMessage } from "../src/lib/gmail-history";
import {
  summarizeThreads,
  type MailChannels,
  type ThreadHeader,
} from "../src/lib/conversation-threads";
import { initialHistoryRun } from "../src/lib/gmail-history-refresh";

test("a completed live directory stays available after reload without a historical analysis", () => {
  assert.equal(
    initialHistoryRun(
      [
        {
          id: "live",
          purpose: "continuous",
          status: "completed",
          is_live_directory: true,
        },
      ],
      "live",
    ),
    "live",
  );
});

const classify = (body: string) =>
  replyIntent({
    direction: "inbound",
    nature: "personal",
    sender: "client@example.com",
    body,
  });
test("interest includes information, pricing, applications and future contact; ambiguity stays in review", () => {
  for (const text of [
    "Envíame información",
    "¿Qué tasas tienen?",
    "Háblame el próximo mes",
    "Quiero aplicar",
    "Adjunto mis documentos",
    "Can you send me information?",
    "What are your rates?",
    "Call me next month",
    "I'm interested",
    "No ahora, llámame el próximo mes",
  ]) {
    assert.equal(classify(text), "positive", text);
  }
  for (const text of [
    "No estoy interesado",
    "Ya no me interesa",
    "Not interested",
    "Please remove me",
    "No me contacten",
    "Ya no necesito financiamiento",
  ])
    assert.equal(classify(text), "negative", text);
  for (const text of [
    "Gracias",
    "Sí",
    "No me envíes información",
    "I don't want to apply",
    "Not interested but send me information",
  ])
    assert.equal(classify(text), "review", text);
  assert.equal(MAIL_ENGAGEMENT_START, "2026-10-13T05:00:00.000Z");
});
test("quoted campaigns, delivery senders, holidays and outgoing messages cannot create interest", () => {
  assert.equal(
    classify(
      "Gracias\n\nOn Monday, Seller wrote:\nI'm interested in financing",
    ),
    "review",
  );
  assert.equal(
    classify("Not interested\n> Please send me information"),
    "negative",
  );
  assert.equal(
    classify("I'm out of the office. Send me information"),
    "ignored",
  );
  for (const sender of [
    "mailer-daemon@googlemail.com",
    "postmaster@example.com",
    "no-reply@example.com",
    "bounces+123@example.com",
  ]) {
    assert.equal(
      replyIntent({
        direction: "inbound",
        nature: "personal",
        sender,
        body: "Send me information",
      }),
      "ignored",
    );
  }
  assert.equal(
    replyIntent({
      direction: "outbound",
      nature: "personal",
      body: "Send me information",
    }),
    "ignored",
  );
  for (const headers of [
    [{ name: "From", value: "mailer-daemon@googlemail.com" }],
    [{ name: "From", value: "noreply@example.com" }],
    [
      { name: "From", value: "client@example.com" },
      { name: "X-Autoreply", value: "yes" },
    ],
    [
      { name: "From", value: "client@example.com" },
      { name: "Subject", value: "Out of office: funding" },
    ],
  ]) {
    const snapshot = snapshotMessage(
      {
        id: "1",
        threadId: "t",
        internalDate: "1000",
        payload: {
          headers,
          body: { data: Buffer.from("I'm interested").toString("base64url") },
          mimeType: "text/plain",
        },
      },
      "seller@example.com",
    );
    assert.notEqual(snapshot.nature, "personal");
  }
});

test("all mail linked to a case stays visible regardless of intent, age, direction or classifier backfill", () => {
  const context: MailChannels = {
    conversations: ["client", "lender", "team"].map((id) => ({
      id,
      opportunity_id: "case",
      account_id: "account",
      area: "seller",
      submission_id: null,
      needs_attention: false,
      subject: "Historical mail",
      updated_at: "2026-10-01T12:00:00Z",
    })),
    processes: [],
    routes: [],
    lenders: [{ id: "lender", name: "Lender", email: "funding@lender.test" }],
    lender_contacts: [],
    client_emails: ["rob@kidsinmotionwi.com"],
    team_emails: ["seller@example.com"],
  };
  const incoming: ThreadHeader = {
    id: "received",
    conversation_id: "client",
    sender: "rob@kidsinmotionwi.com",
    direction: "inbound",
    nature: "personal",
    reply_intent: null,
    sent_at: "2026-10-05T18:49:00Z",
    participants: [{ role: "to", email: "seller@example.com" }],
  };
  for (const reply_intent of [
    null,
    "positive",
    "review",
    "negative",
    "ignored",
  ] as const) {
    const summaries = summarizeThreads(context, [
      { ...incoming, reply_intent },
    ]);
    assert.equal(
      summaries.find((s) => s.category === "client")?.message_ids?.[0],
      "received",
    );
  }
  const outgoing: ThreadHeader = {
    ...incoming,
    id: "sent",
    sender: "seller@example.com",
    direction: "outbound",
    reply_intent: "ignored",
    participants: [{ role: "to", email: "rob@kidsinmotionwi.com" }],
  };
  for (const nature of ["personal", "campaign", "automatic"]) {
    assert.equal(
      summarizeThreads(context, [{ ...outgoing, nature }]).filter(
        (s) => s.category === "client",
      ).length,
      1,
    );
  }
  const rows: ThreadHeader[] = [
    incoming,
    outgoing,
    {
      ...outgoing,
      id: "lender-send",
      conversation_id: "lender",
      participants: [{ role: "to", email: "funding@lender.test" }],
    },
    {
      ...incoming,
      id: "team-mail",
      conversation_id: "team",
      sender: "seller@example.com",
    },
  ];
  const visible = summarizeThreads(context, rows);
  assert.deepEqual(
    visible.flatMap((s) => s.message_ids || []).sort(),
    rows.map((m) => m.id).sort(),
  );
  assert(visible.some((s) => s.category === "lender"));
  assert(visible.some((s) => s.category === "team"));
  assert.equal(rows[0].reply_intent, null);
  // Headers from a conversation outside the authorized context remain excluded.
  assert(
    !summarizeThreads(context, [
      ...rows,
      { ...incoming, id: "private", conversation_id: "other-case" },
    ]).some((s) => s.message_ids?.includes("private")),
  );
});
