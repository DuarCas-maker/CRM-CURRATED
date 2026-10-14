import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeThreads,
  filterThreads,
  type MailChannels,
  type ThreadHeader,
} from "../src/lib/conversation-threads";
import {
  lenderEmailResolver,
  lenderReplyRecipients,
} from "../src/lib/lender-mail";
import type { Conversation } from "../src/lib/domain";

const context: MailChannels = {
  conversations: [
    {
      id: "mixed",
      opportunity_id: "newday",
      process_id: "p1",
      account_id: "daniel",
      subject: "Funding application",
      submission_id: null,
      area: "seller",
      needs_attention: true,
      updated_at: "2026-10-13T12:00:00Z",
    },
    {
      id: "another",
      opportunity_id: "newday",
      process_id: "p1",
      account_id: "laura",
      subject: "Documents",
      submission_id: null,
      area: "seller",
      needs_attention: false,
      updated_at: "2026-10-13T12:00:00Z",
    },
  ] as Conversation[],
  processes: [],
  routes: [],
  lenders: [
    { id: "fundpro", name: "Fund Pro", email: "newdeals@fundprollc.com" },
    { id: "fantastic", name: "Fantastic", email: "uw@fantastic-funding.com" },
  ],
  lender_contacts: [
    { lender_id: "fundpro", email: "brandon@fundprollc.com", name: "Brandon" },
  ],
  team_emails: ["daniel@curatedfinancial.com", "laura@curatedfinancial.com"],
  client_emails: ["newday@gmail.com"],
};
const message = (
  id: string,
  sender: string,
  to: string[],
  conversation_id = "mixed",
): ThreadHeader => ({
  id,
  conversation_id,
  sender,
  sent_at: `2026-10-13T12:00:0${id}Z`,
  direction: sender.endsWith("@curatedfinancial.com") ? "outbound" : "inbound",
  internet_message_id: `<${id}>`,
  references_header: id === "0" ? "" : "<0>",
  body: `Message ${id}`,
  participants: to.map((email) => ({ email, role: "to" })),
});
const messages = [
  message("0", "daniel@curatedfinancial.com", [
    "brandon@fundprollc.com",
    "uw@fantastic-funding.com",
  ]),
  message("1", "brandon@fundprollc.com", [
    "daniel@curatedfinancial.com",
    "uw@fantastic-funding.com",
  ]),
  message("2", "uw@fantastic-funding.com", ["daniel@curatedfinancial.com"]),
  message(
    "3",
    "laura@curatedfinancial.com",
    ["newdeals@fundprollc.com"],
    "another",
  ),
  message(
    "4",
    "analyst@fundprollc.com",
    ["laura@curatedfinancial.com"],
    "another",
  ),
  message("5", "newday@gmail.com", ["daniel@curatedfinancial.com"]),
];
test("shared Gmail history splits by company, merges team/contact threads within a process, and retains the broadcast", () => {
  const threads = summarizeThreads(context, messages);
  const lenders = filterThreads(threads, "lender");
  assert.equal(lenders.length, 2);
  const fundpro = lenders.find((s) => s.lender_ids[0] === "fundpro")!;
  const fantastic = lenders.find((s) => s.lender_ids[0] === "fantastic")!;
  assert.deepEqual(fundpro.message_ids, ["4", "3", "1", "0"]);
  assert.deepEqual(fantastic.message_ids, ["2", "0"]);
  assert.deepEqual(fundpro.conversation_ids, ["another", "mixed"]);
  assert.equal(filterThreads(threads, "client")[0].message_ids?.[0], "5");
  assert.equal(fundpro.snippet, "Message 4");
  assert.equal(messages.length, 6);
});
test("company views cannot combine another client's or another financing process's emails", () => {
  const c = {
    ...context,
    conversations: [
      ...context.conversations,
      { ...context.conversations[0], id: "second", process_id: "p2" },
      { ...context.conversations[0], id: "othercase", opportunity_id: "other" },
    ],
  };
  const rows = [
    ...messages,
    message("6", "brandon@fundprollc.com", [], "second"),
    message("7", "brandon@fundprollc.com", [], "othercase"),
  ];
  const views = filterThreads(summarizeThreads(c, rows), "lender");
  assert.equal(views.length, 4);
  assert.equal(
    views.find((v) => v.opportunity_id === "other")?.message_ids?.join(),
    "7",
  );
  assert.equal(
    views.find((v) => v.process_id === "p2")?.message_ids?.join(),
    "6",
  );
});
test("reply all includes the selected company and other team members, excluding customer, other lenders and BCC", () => {
  const m = message("1", "brandon@fundprollc.com", [
    "daniel@curatedfinancial.com",
    "newday@gmail.com",
    "uw@fantastic-funding.com",
    "laura@curatedfinancial.com",
    "analyst@fundprollc.com",
  ]);
  m.participants!.push({ role: "bcc", email: "secret@fundprollc.com" });
  assert.deepEqual(
    lenderReplyRecipients(m, "fundpro", context, "daniel@curatedfinancial.com"),
    {
      to: "brandon@fundprollc.com",
      cc: ["laura@curatedfinancial.com", "analyst@fundprollc.com"],
    },
  );
  assert.equal(
    lenderReplyRecipients(
      messages[0],
      "fantastic",
      context,
      "laura@curatedfinancial.com",
    ).to,
    "uw@fantastic-funding.com",
  );
});
test("exact addresses work on shared providers; ambiguous domains and clients never become company matches", () => {
  const resolve = lenderEmailResolver({
    ...context,
    lenders: [
      ...context.lenders,
      { id: "gmail", name: "One", email: "lender@gmail.com" },
      { id: "shared", name: "Other", email: "other@fundprollc.com" },
    ],
  });
  assert.equal(resolve("lender@gmail.com"), "gmail");
  assert.equal(resolve("someone@gmail.com"), undefined);
  assert.equal(resolve("unknown@fundprollc.com"), undefined);
  assert.equal(resolve("BRANDON@FUNDPROLLC.COM"), "fundpro");
  assert.equal(resolve("newday@gmail.com"), undefined);
  assert.equal(resolve("daniel@curatedfinancial.com"), undefined);
});
