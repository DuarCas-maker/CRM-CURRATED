import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAddresses,
  snapshotMessage,
  primaryPeers,
  historicalQuery,
  twoMonthsBefore,
  shouldCopyGmailFile,
  excludedGmailMessage,
  type GmailMessage,
} from "../src/lib/gmail-history";

function message(
  headers: Record<string, string> = {},
  extras: Partial<GmailMessage> = {},
): GmailMessage {
  return {
    id: "m1",
    threadId: "t1",
    internalDate: "1791580800000",
    labelIds: ["SENT"],
    payload: {
      mimeType: "text/plain",
      headers: Object.entries({
        From: "seller@example.com",
        To: '"Smith, Daniel" <daniel@client.com>, owner@second.com',
        Cc: "broker@broker.com",
        ...headers,
      }).map(([name, value]) => ({ name, value })),
      body: { data: Buffer.from("Hello").toString("base64url") },
    },
    ...extras,
  };
}
test("recipient parsing preserves quoted commas, multiple direct recipients and copy-only participants", () => {
  assert.deepEqual(
    parseAddresses(
      '"Smith, Daniel" <Daniel@CLIENT.com>, owner@second.com',
      "to",
    ),
    [
      { email: "daniel@client.com", name: "Smith, Daniel", role: "to" },
      { email: "owner@second.com", name: "", role: "to" },
    ],
  );
  const snapshot = snapshotMessage(message(), "seller@example.com");
  assert.equal(snapshot.body, "Hello");
  assert.deepEqual(
    primaryPeers(snapshot, ["seller@example.com"]).map((p) => p.email),
    ["daniel@client.com", "owner@second.com"],
  );
  assert.equal(snapshot.participants.at(-1)?.role, "cc");
  const longText = "A".repeat(100001) + " Final evidence";
  const longMessage = message();
  longMessage.payload.body = {
    data: Buffer.from(longText).toString("base64url"),
  };
  assert.equal(
    snapshotMessage(longMessage, "seller@example.com").body,
    longText,
  );
});
test("historical queries include sent and archived messages but never spam, trash or drafts", () => {
  const q = historicalQuery("2025-10-10T00:00:00Z", "2026-10-10T00:00:00Z");
  assert.ok(q.includes("-in:spam -in:trash -in:drafts"));
  assert.ok(!q.includes("in:inbox"));
  for (const label of ["SPAM", "TRASH", "DRAFT"])
    assert.ok(excludedGmailMessage(message({}, { labelIds: [label] })));
  assert.equal(excludedGmailMessage(message({}, { labelIds: [] })), false);
  assert.equal(
    twoMonthsBefore("2026-04-30T00:00:00Z"),
    "2026-02-28T00:00:00.000Z",
  );
});
test("automatic responses and campaigns are distinguishable from personal communication", () => {
  assert.equal(
    snapshotMessage(
      message({ "Auto-Submitted": "auto-replied" }),
      "seller@example.com",
    ).nature,
    "automatic",
  );
  assert.equal(
    snapshotMessage(
      message({ "List-Unsubscribe": "<mailto:unsubscribe@x.com>" }),
      "seller@example.com",
    ).nature,
    "campaign",
  );
  assert.equal(
    snapshotMessage(message({ "Auto-Submitted": "no" }), "seller@example.com")
      .nature,
    "personal",
  );
});
test("a temporary failure or an unclassified delivery report never becomes a permanent bounce or funding rejection", () => {
  for (const [status, expected] of [
    ["4.2.2", "temporary_bounce"],
    ["5.1.1", "permanent_bounce"],
    ["", "delivery_report"],
  ]) {
    const msg = message(
      {},
      {
        labelIds: [],
        payload: {
          mimeType: "multipart/report",
          headers: [{ name: "From", value: "mailer-daemon@example.com" }],
          parts: [
            {
              mimeType: "message/delivery-status",
              body: {
                data: Buffer.from(`Status: ${status}\r\n`).toString(
                  "base64url",
                ),
              },
            },
          ],
        },
      },
    );
    assert.equal(snapshotMessage(msg, "seller@example.com").nature, expected);
  }
});
test("both inline and remote attachments preserve separate MIME part identities", () => {
  const msg = message(
    {},
    {
      payload: {
        parts: [
          {
            filename: "application.pdf",
            mimeType: "application/pdf",
            body: { data: "abc", size: 2 },
          },
          {
            filename: "statement.pdf",
            mimeType: "application/pdf",
            body: { attachmentId: "remote1", size: 50 },
          },
        ],
      },
    },
  );
  assert.deepEqual(
    snapshotMessage(msg, "seller@example.com").attachments.map(
      (a) => a.part_id,
    ),
    ["0.0", "0.1"],
  );
});
test("recent documents are copied; active cases also retrieve identifiable older application/bank/contract files", () => {
  assert.ok(shouldCopyGmailFile("2026-10-01", "2026-08-10", false, "file.pdf"));
  assert.ok(
    shouldCopyGmailFile("2026-07-01", "2026-08-10", true, "Bank_statement.pdf"),
  );
  assert.equal(
    shouldCopyGmailFile(
      "2026-07-01",
      "2026-08-10",
      false,
      "Bank_statement.pdf",
    ),
    false,
  );
  assert.equal(
    shouldCopyGmailFile("2026-07-01", "2026-08-10", true, "newsletter.pdf"),
    false,
  );
});
