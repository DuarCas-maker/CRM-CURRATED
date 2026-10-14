import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeOriginalThreads as summarizeThreads,
  filterThreads,
  elapsedMailTime,
  type MailChannels,
  type ThreadHeader,
} from "../src/lib/conversation-threads";
import type { Conversation } from "../src/lib/domain";
const co = (id: string, process = "p", opportunity = "case"): Conversation => ({
  id,
  process_id: process,
  opportunity_id: opportunity,
  subject: "Solicitud",
  account_id: id,
  submission_id: null,
  area: "seller",
  needs_attention: id === "a",
  updated_at: "2026-10-12T12:00:00Z",
});
const mail = (
  id: string,
  conversation_id: string,
  sender: string,
  internet_message_id: string,
  references_header = "",
): ThreadHeader => ({
  id,
  conversation_id,
  sender,
  internet_message_id,
  references_header,
  sent_at: "2026-10-12T12:00:00Z",
  direction: "inbound",
  body: "Documentos",
  participants: [
    { email: "daniel@example.com", role: "to" },
    { email: "private@example.com", role: "bcc" },
  ],
});
const context = (conversations: Conversation[]): MailChannels => ({
  conversations,
  processes: [],
  routes: [{ conversation_id: "a", lender_id: "capital" }],
  lenders: [],
  lender_contacts: [],
  team_emails: ["daniel@example.com", "laura@example.com"],
  client_emails: ["client@example.com"],
});
test("lender replies across team mailboxes stay in one unique thread without exposing BCC", () => {
  const threads = summarizeThreads(context([co("a"), co("b"), co("c")]), [
    mail("1", "a", "analyst@example.com", "<original>"),
    mail("2", "b", "laura@example.com", "<reply>", "<original>"),
    mail("3", "c", "analyst@example.com", "<separate>"),
  ]);
  assert.equal(threads.length, 2);
  const group = threads.find((t) => t.conversation_ids.includes("b"))!;
  assert.deepEqual(group.conversation_ids, ["a", "b"]);
  assert.equal(group.category, "lender");
  assert.equal(group.unread, true);
  assert(!group.participants.some((p) => p.role === "bcc"));
});
test("identical subjects and senders never combine independent lender threads", () => {
  assert.equal(
    summarizeThreads(context([co("a"), co("b")]), [
      mail("1", "a", "analyst@example.com", "<one>"),
      mail("2", "b", "analyst@example.com", "<two>"),
    ]).length,
    2,
  );
});
test("RFC references and explicit replies cannot cross case or financing process boundaries", () => {
  const rows = [
    co("a"),
    co("b", "p", "other"),
    co("c", "p2"),
    co("d", ""),
    co("e", "p2"),
  ];
  const threads = summarizeThreads(
    context(rows),
    rows.map((c, i) =>
      mail(String(i), c.id, "analyst@example.com", "<shared>"),
    ),
    [{ conversation_id: "b", reply_message_id: "0" }],
  );
  assert.equal(threads.length, 3);
  assert(
    threads.every((t) =>
      t.conversation_ids.every(
        (id) =>
          rows.find((c) => c.id === id)?.opportunity_id === t.opportunity_id,
      ),
    ),
  );
  assert(
    threads.every(
      (t) =>
        new Set(
          t.conversation_ids
            .map((id) => rows.find((c) => c.id === id)?.process_id)
            .filter(Boolean),
        ).size <= 1,
    ),
  );
  assert(
    threads.some(
      (t) =>
        t.conversation_ids.includes("c") && t.conversation_ids.includes("e"),
    ),
  );
});
test("explicit queued reply relationship preserves a thread when RFC headers are unavailable", () => {
  assert.equal(
    summarizeThreads(
      context([co("a"), co("b")]),
      [mail("1", "a", "analyst@example.com", "")],
      [{ conversation_id: "b", reply_message_id: "1" }],
    ).length,
    1,
  );
});
test("categories and filters count threads, retain full-history matches and isolate clients", () => {
  const threads = summarizeThreads(context([co("a"), co("b"), co("c")]), [
    mail("1", "a", "analyst@example.com", "<a>"),
    mail("2", "b", "client@example.com", "<b>"),
    mail("3", "c", "laura@example.com", "<c>"),
  ]);
  assert.equal(filterThreads(threads, "lender").length, 1);
  assert.equal(filterThreads(threads, "client").length, 1);
  assert.equal(filterThreads(threads, "team").length, 1);
  assert.equal(filterThreads(threads, "all", true).length, 1);
  threads[0].search_matched = true;
  assert.equal(
    filterThreads(threads, "all", false, "historical content").length,
    1,
  );
});
test("relative age uses actual timestamps and does not invent missing messages", () => {
  assert.equal(elapsedMailTime(null, "es"), "Sin mensaje registrado");
  assert.match(
    elapsedMailTime(
      "2026-10-12T11:00:00Z",
      "es",
      Date.parse("2026-10-12T12:00:00Z"),
    ),
    /1 h/,
  );
});
