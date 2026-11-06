import type { ResolvedComposioBinding } from "../../src/lib/server/mail-transport/contract";

// Synthetic shapes from the S00 proxy contract; no journal or real identities.
export const fixtureBinding: ResolvedComposioBinding = {
  accountId: "11111111-2222-4333-8444-555555555555",
  connectedAccountId: "ca_fixture_mailbox",
  authConfigId: "ac_fixture_gmail",
  userId: "fixture-composio-owner",
  mailboxEmail: "mailbox@example.test",
  verifiedMailboxEmail: "mailbox@example.test",
  identityVerified: true,
  status: "active",
  revision: 1,
  quotaProjectId: "fixture-google-project",
};
export const fixtureKey = "s02-fixture-key-never-real";
export const fixtureMime = [
  "From: mailbox@example.test",
  "To: controlled@example.test",
  "Message-ID: <s02-fixture@example.test>",
  "In-Reply-To: <original-fixture@example.test>",
  "References: <original-fixture@example.test>",
  "Subject: S02 fictional message",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Fixture only. No message is sent.",
].join("\r\n");
export const fixtureRaw = Buffer.from(fixtureMime).toString("base64url");
export const fixtureSend = { raw: fixtureRaw, threadId: "def456" };
export const fixtureData = {
  profile: {
    emailAddress: fixtureBinding.mailboxEmail,
    historyId: "123456789",
  },
  messages: {
    messages: [{ id: "abc123", threadId: "def456" }],
    nextPageToken: "opaque-next+/=",
  },
  message: { id: "abc123", threadId: "def456", payload: { headers: [] } },
  thread: {
    id: "def456",
    messages: [{ id: "abc123", threadId: "def456" }],
  },
  history: {
    historyId: "123456789",
    history: [
      { id: "123456788", messagesAdded: [{ message: { id: "abc123" } }] },
    ],
    nextPageToken: "opaque-history-cursor",
  },
  attachment: { data: "SGVsbG8", size: 5 },
  signature: {
    sendAsEmail: fixtureBinding.mailboxEmail,
    displayName: "Fixture sender",
    signature: "<p>Fixture signature</p>",
  },
  send: { id: "abc123", threadId: "def456" },
};
export const jsonResponse = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export function fakeProxy(response: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  };
  return { calls, fetchImpl };
}
