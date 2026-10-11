import test from "node:test";
import assert from "node:assert/strict";
import {
  readableMail,
  messageChannels,
  suggestedReply,
} from "../src/lib/mail-display";
import { buildMime, messageText } from "../worker/mime";
test("MIME alternatives produce one readable body and never mix a text attachment into the email", () => {
  const body = (s: string) => ({ data: Buffer.from(s).toString("base64url") });
  assert.equal(
    messageText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: body("Current message") },
        { mimeType: "text/html", body: body("<p>Current message</p>") },
      ],
    }),
    "Current message",
  );
  assert.equal(
    messageText({
      mimeType: "text/plain",
      filename: "statement.txt",
      body: body("Attachment content"),
    }),
    "",
  );
  assert.match(
    messageText({
      mimeType: "text/html",
      body: body("<p>Hello</p><p>Second paragraph<br>Next line</p>"),
    }),
    /Hello\n.*Second paragraph\nNext line/,
  );
});
test("chat hides signatures and quoted history without rewriting original evidence", () => {
  const body =
    "We will finalize Monday\n\nAnthony Collin\nChief Executive Officer\nSmart Business Funding\nEmail: Anthony@example.com\n\nOn Fri, Oct 9, 2026 at 3:37 PM Daniel <daniel@example.com>\nwrote:\n> What else is needed?";
  assert.equal(readableMail(body).text, "We will finalize Monday");
  assert.equal(readableMail(body).original, body);
  assert.equal(readableMail(body).folded, true);
  assert.equal(
    readableMail(
      "On Monday we will send the documents.\nPlease wait for our confirmation.",
    ).folded,
    false,
  );
  assert.equal(
    readableMail(
      "Application complete\n\nOn Fri, Oct 9, 2026 at 3:37 PM Daniel <daniel@example.com>\nwrote:\n> Older content",
    ).text,
    "Application complete",
  );
});
const context = {
  team: ["daniel@team.test", "valentina@team.test"],
  clients: ["customer@client.test"],
  lenders: [
    { email: "anthony@lender.test", lender_id: "a" },
    { email: "submit@lender.test", lender_id: "a" },
    { email: "other@lender.test", lender_id: "b" },
  ],
};
test("shared historical send belongs to each addressed lender, but actual replies stay with the sender's lender", () => {
  assert.deepEqual(
    messageChannels(
      {
        sender: context.team[0],
        direction: "outbound",
        participants: context.lenders.map((l) => ({
          email: l.email,
          role: "bcc",
        })),
      },
      context,
    ),
    ["lender:a", "lender:b"],
  );
  assert.deepEqual(
    messageChannels(
      {
        sender: "anthony@lender.test",
        direction: "inbound",
        participants: context.lenders.map((l) => ({
          email: l.email,
          role: "cc",
        })),
      },
      context,
    ),
    ["lender:a"],
  );
  assert.deepEqual(
    messageChannels(
      { sender: "submit@lender.test", direction: "inbound" },
      context,
    ),
    ["lender:a"],
  );
  assert.deepEqual(
    messageChannels(
      { sender: "someone@lender.test", direction: "inbound" },
      context,
    ),
    ["review"],
  );
});
test("team replies are on our side but internal messages and customer mail keep separate channels", () => {
  assert.deepEqual(
    messageChannels(
      {
        sender: context.team[1],
        direction: "inbound",
        participants: [{ email: context.team[0], role: "to" }],
      },
      context,
    ),
    ["team"],
  );
  assert.deepEqual(
    messageChannels(
      {
        sender: context.team[1],
        direction: "inbound",
        participants: [{ email: "submit@lender.test", role: "to" }],
      },
      context,
    ),
    ["lender:a"],
  );
  assert.deepEqual(
    messageChannels(
      { sender: context.clients[0], direction: "inbound" },
      context,
    ),
    ["client"],
  );
});
test("reply suggestions exclude hidden copies and other lenders; MIME preserves reviewed visible CC", () => {
  const participants = [
    { email: "daniel@team.test", role: "to" },
    { email: "submit@lender.test", role: "cc" },
    { email: "other@lender.test", role: "cc" },
    { email: "secret@lender.test", role: "bcc" },
  ];
  assert.deepEqual(
    suggestedReply(
      participants,
      "anthony@lender.test",
      ["daniel@team.test"],
      ["anthony@lender.test", "submit@lender.test"],
    ),
    { to: "anthony@lender.test", cc: ["submit@lender.test"] },
  );
  const raw = Buffer.from(
    buildMime({
      from: "daniel@team.test",
      to: "anthony@lender.test",
      cc: ["submit@lender.test"],
      subject: "Client A",
      body: "Please review",
      messageId: "<unique@team.test>",
    }),
    "base64url",
  ).toString();
  assert.match(raw, /Cc: submit@lender.test/);
  assert.doesNotMatch(raw, /other@lender.test|secret@lender.test/);
  assert.throws(
    () =>
      buildMime({
        from: "a@b.test",
        to: "b@c.test",
        cc: ["c@d.test\r\nBcc: e@f.test"],
        subject: "s",
        body: "b",
        messageId: "<a@b.test>",
      }),
    /INVALID_MAIL_HEADER/,
  );
});
