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
test("inbox hides unanswered lender channels even when they share a client's positive thread", () => {
  const context: MailChannels = {
    enforce_engagement: true,
    conversations: [
      {
        id: "c",
        opportunity_id: "o",
        account_id: "a",
        area: "seller",
        submission_id: null,
        needs_attention: false,
        subject: "Funding",
        updated_at: "2026-10-13T08:00:00Z",
      },
    ],
    processes: [],
    routes: [],
    lenders: [
      { id: "l1", name: "Lender 1", email: "l1@lender1.test" },
      { id: "l2", name: "Lender 2", email: "l2@lender2.test" },
    ],
    lender_contacts: [],
    client_emails: ["client@example.com"],
    team_emails: ["seller@example.com"],
  };
  const header = (
    id: string,
    sender: string,
    direction: "inbound" | "outbound",
    recipients: string[],
    intent: ThreadHeader["reply_intent"],
  ): ThreadHeader => ({
    id,
    conversation_id: "c",
    sender,
    direction,
    sent_at: `2026-10-13T08:00:0${id}Z`,
    nature: "personal",
    reply_intent: intent,
    participants: recipients.map((email) => ({ email, role: "to" })),
  });
  const rows = [
    header(
      "1",
      "seller@example.com",
      "outbound",
      ["client@example.com", "l1@lender1.test", "l2@lender2.test"],
      "ignored",
    ),
    header(
      "2",
      "client@example.com",
      "inbound",
      ["seller@example.com"],
      "positive",
    ),
    header("3", "l1@lender1.test", "inbound", ["seller@example.com"], "review"),
    header(
      "4",
      "seller@example.com",
      "outbound",
      ["client@example.com"],
      "ignored",
    ),
  ];
  const summaries = summarizeThreads(context, rows);
  assert.equal(
    summaries.some((s) => s.category === "client"),
    true,
  );
  assert.deepEqual(
    summaries
      .filter((s) => s.category === "lender")
      .flatMap((s) => s.lender_ids),
    ["l1"],
  );
  assert.equal(
    summarizeThreads(
      context,
      rows.filter((m) => m.direction === "outbound"),
    ).length,
    0,
  );
  assert.equal(
    summarizeThreads(context, [{ ...rows[1], reply_intent: "negative" }])
      .length,
    0,
  );
  context.conversations[0].manually_incorporated_at = "2026-10-13T08:00:00Z";
  assert.equal(
    summarizeThreads(context, [{ ...rows[1], reply_intent: "review" }]).length,
    1,
  );
});

test("established client exchanges remain visible when replies need review, without treating campaigns or unrelated sends as engagement", () => {
  const context: MailChannels = {
    enforce_engagement: true,
    conversations: ["client", "unrelated", "other-case"].map((id) => ({
      id,
      opportunity_id: id === "other-case" ? "other" : "newday",
      account_id: "account",
      area: "seller",
      submission_id: null,
      needs_attention: false,
      subject: "New Day Cafe",
      updated_at: "2026-10-14T20:00:00Z",
    })),
    processes: [],
    routes: [],
    lenders: [{ id: "lender", name: "Lender", email: "funding@lender.test" }],
    lender_contacts: [],
    client_emails: ["newdaycafe01@gmail.com"],
    team_emails: ["seller@example.com"],
  };
  const incoming: ThreadHeader = {
    id: "received",
    conversation_id: "client",
    sender: "newdaycafe01@gmail.com",
    direction: "inbound",
    nature: "personal",
    reply_intent: "review",
    sent_at: "2026-10-14T19:00:00Z",
    participants: [{ role: "to", email: "seller@example.com" }],
  };
  const outgoing: ThreadHeader = {
    ...incoming,
    id: "sent",
    sender: "seller@example.com",
    direction: "outbound",
    reply_intent: "ignored",
    sent_at: "2026-10-14T20:00:00Z",
    participants: [{ role: "to", email: "newdaycafe01@gmail.com" }],
  };
  const visible = summarizeThreads(context, [incoming, outgoing]);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].category, "client");
  assert.deepEqual(visible[0].message_ids, ["sent", "received"]);
  assert.equal(incoming.reply_intent, "review");
  assert.equal(summarizeThreads(context, [incoming]).length, 0);
  assert.equal(summarizeThreads(context, [outgoing]).length, 0);
  for (const nature of ["campaign", "automatic"]) {
    assert.equal(summarizeThreads(context, [incoming, { ...outgoing, nature }]).length, 0);
  }
  for (const reply_intent of ["negative", "ignored"] as const) {
    assert.equal(summarizeThreads(context, [{ ...incoming, reply_intent }, outgoing]).length, 0);
  }
  assert.equal(summarizeThreads(context, [incoming, { ...outgoing, conversation_id: "unrelated" }]).length, 0);
  assert.equal(summarizeThreads(context, [incoming, {
    ...outgoing,
    participants: [...outgoing.participants!, { role: "to", email: "funding@lender.test" }],
  }]).length, 0);
  assert.equal(summarizeThreads(context, [incoming, outgoing, {
    ...incoming,
    id: "other",
    conversation_id: "other-case",
  }]).length, 1);
});
