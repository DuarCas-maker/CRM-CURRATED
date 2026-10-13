import test from "node:test";
import assert from "node:assert/strict";
import {
  mailChatMessages,
  orderMailMessages,
  type MailReplySend,
} from "../src/lib/mail-chat";
import type { Message } from "../src/lib/domain";

const accounts = [{ id: "daniel", email: "daniel@example.com" }];
const queued: MailReplySend = {
  id: "queued",
  conversation_id: "thread",
  reply_message_id: "received",
  account_id: "daniel",
  to_email: "client@example.com",
  cc_emails: ["assistant@example.com"],
  body: "Gracias, seguimos con la solicitud.",
  subject: "Solicitud",
  status: "queued",
  message_id_header: "<reply@example.com>",
  created_at: "2026-10-12T12:01:00Z",
};
const received: Message = {
  id: "received",
  conversation_id: "thread",
  direction: "inbound",
  sender: "client@example.com",
  body: "¿Qué sigue?",
  status: "received",
  sent_at: "2026-10-12T12:00:00Z",
};

test("date order compares actual instants across time zones and leaves pagination data unchanged", () => {
  const loaded = [
    { ...received, id: "later", sent_at: "2026-10-12T10:00:00-05:00" },
    { ...received, id: "earlier", sent_at: "2026-10-12T14:30:00Z" },
  ];
  assert.deepEqual(
    orderMailMessages(loaded).map((m) => m.id),
    ["later", "earlier"],
  );
  assert.deepEqual(
    orderMailMessages(loaded, "oldest").map((m) => m.id),
    ["earlier", "later"],
  );
  assert.deepEqual(
    loaded.map((m) => m.id),
    ["later", "earlier"],
  );
  assert.deepEqual(orderMailMessages([]), []);
});

test("a queued or failed reply remains visible in its thread with the sender and visible recipients", () => {
  for (const status of ["queued", "sending", "failed", "uncertain"]) {
    const messages = mailChatMessages(
      [received],
      [{ ...queued, status }],
      accounts,
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[1].queued_send?.reply_message_id, received.id);
    assert.equal(messages[1].sender, "daniel@example.com");
    assert.equal(messages[1].status, status);
    assert.deepEqual(messages[1].participants, [
      { email: "client@example.com", role: "to" },
      { email: "assistant@example.com", role: "cc" },
    ]);
  }
});

test("the queued bubble is replaced by actual mail without hiding unrelated messages from another mailbox", () => {
  const sent: Message = {
    ...received,
    id: "sent",
    direction: "outbound",
    sender: "daniel@example.com",
    body: queued.body,
    status: "sent",
    sent_at: "2026-10-12T12:02:00Z",
    gmail_message_id: "gmail-id",
    internet_message_id: queued.message_id_header,
  };
  assert.equal(
    mailChatMessages(
      [received, sent],
      [{ ...queued, status: "sent" }],
      accounts,
    ).length,
    2,
  );
  assert.equal(
    mailChatMessages(
      [{ ...sent, conversation_id: "other-thread" }],
      [queued],
      accounts,
    ).length,
    1,
  );
  assert.equal(
    mailChatMessages(
      [{ ...sent, internet_message_id: "<changed-by-provider@example.com>" }],
      [{ ...queued, gmail_message_id: "gmail-id", status: "sent" }],
      accounts,
    ).length,
    1,
  );
  assert.equal(
    mailChatMessages(
      [
        {
          ...sent,
          conversation_id: "other-thread",
          internet_message_id: "<unrelated@example.com>",
        },
      ],
      [{ ...queued, gmail_message_id: "gmail-id" }],
      accounts,
    ).length,
    2,
  );
});
