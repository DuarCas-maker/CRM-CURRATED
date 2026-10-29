import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  runComposioTest,
  publicRunReport,
  validateRunState,
  mime,
  type RunState,
  type RunStore,
} from "../scripts/pipeline-os/s00-composio-runner";
const sentinel = "private-runner-sentinel";
const env = {
  COMPOSIO_API_KEY: sentinel,
  COMPOSIO_AUTH_CONFIG_ID: "ac_fixture",
  COMPOSIO_CONNECTED_ACCOUNT_1_ID: "ca_first",
  COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_second",
  S00_TEST_RECIPIENT_EMAIL: "recipient@fictional.test",
};
const identities = ["one@fictional.test", "two@fictional.test"];
const ids = ["111aaa", "222bbb"];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
class Memory implements RunStore {
  value?: RunState;
  async load() {
    return this.value ? structuredClone(this.value) : undefined;
  }
  async save(s: RunState) {
    this.value = structuredClone(s);
  }
}
async function harness() {
  const store = new Memory();
  const calls: { url: string; body: any }[] = [];
  const sent: any[][] = [[], []];
  let reply = false;
  const pdf = await readFile("output/pdf/S00-composio-fixture.pdf");
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input),
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    assert.equal(new Headers(init?.headers).get("x-api-key"), sentinel);
    assert.equal(init?.redirect, "manual");
    assert.ok(url.startsWith("https://backend.composio.dev/api/v3.1/"));
    if (url.endsWith("project/usage/summary"))
      return json({
        entities: { tool_calls: { event_count: 0, total_quantity: "0" } },
        instant_charge: "0",
      });
    if (url.endsWith("auth_configs/ac_fixture"))
      return json({
        id: "ac_fixture",
        toolkit: { slug: "gmail" },
        credentials: {
          scopes:
            "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
          secret: sentinel,
        },
      });
    if (url.includes("connected_accounts/")) {
      const i = url.endsWith("ca_first") ? 0 : 1;
      return json({
        id: i ? "ca_second" : "ca_first",
        toolkit: { slug: "gmail" },
        auth_config: { id: "ac_fixture" },
        status: "ACTIVE",
        user_id: "owner-" + i,
        state: { val: { displayName: identities[i], refresh_token: sentinel } },
      });
    }
    assert.equal(
      url,
      "https://backend.composio.dev/api/v3.1/tools/execute/proxy",
    );
    assert.equal(init?.method, "POST");
    const i = body.connected_account_id === "ca_first" ? 0 : 1;
    assert.equal(body.user_id, "owner-" + i);
    const endpoint = body.endpoint;
    assert.ok(
      endpoint.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/"),
    );
    const wrap = (data: any) => json({ status: 200, data });
    if (endpoint.endsWith("/profile"))
      return wrap({ emailAddress: identities[i] });
    if (endpoint.endsWith("/messages/send")) {
      const s = store.value!;
      assert.equal(
        (sent[i].length ? s.boxes[i].confirmation : s.boxes[i].initial).status,
        "in_flight",
      );
      const raw = Buffer.from(body.body.raw, "base64url").toString("utf8");
      assert.ok(raw.includes("To: recipient@fictional.test"));
      assert.ok(!raw.includes("Bcc:"));
      const id = sent[i].length ? "bb" + i : "aa" + i;
      const subject = raw.match(/Subject: (.*)\r\n/)![1];
      sent[i].push({
        id,
        threadId: ids[i],
        internalDate: String(Date.now()),
        payload: {
          headers: [
            { name: "From", value: identities[i] },
            { name: "To", value: env.S00_TEST_RECIPIENT_EMAIL },
            { name: "Subject", value: subject },
            { name: "Message-ID", value: "<initial" + i + "@fictional.test>" },
          ],
        },
      });
      return wrap({ id, threadId: ids[i] });
    }
    if (endpoint.includes("/attachments/"))
      return wrap({ size: pdf.length, data: pdf.toString("base64url") });
    if (endpoint.endsWith("/threads/" + ids[i])) {
      const messages = [...sent[i]];
      if (reply) {
        const token = "S00-COMPOSIO-" + store.value!.token + "-M" + (i + 1);
        messages.push({
          id: "cc" + i,
          threadId: ids[i],
          internalDate: String(Date.now() - 1000),
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "From", value: env.S00_TEST_RECIPIENT_EMAIL },
              { name: "To", value: identities[i] },
              { name: "Subject", value: "Re: [S00 TEST] " + token },
              { name: "Message-ID", value: "<reply" + i + "@fictional.test>" },
              {
                name: "References",
                value: "<initial" + i + "@fictional.test>",
              },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: {
                  data: Buffer.from("S00 ACK " + token).toString("base64url"),
                },
              },
              {
                mimeType: "application/pdf",
                filename: "S00-composio-fixture.pdf",
                body: { attachmentId: "fixture_attachment", size: pdf.length },
              },
            ],
          },
        });
      }
      return wrap({ id: ids[i], messages });
    }
    throw new Error("Unexpected fixture endpoint");
  };
  const run = (
    action: Parameters<typeof runComposioTest>[2],
    included = false,
    fetchOverride?: typeof fetch,
  ) =>
    runComposioTest(env, store, action, {
      execute: true,
      includedCallsConfirmed: included,
      fetchImpl: fetchOverride ?? fetchImpl,
    });
  return {
    store,
    calls,
    sent,
    run,
    fetchImpl,
    replies() {
      reply = true;
    },
  };
}

test("runner defaults offline without env loading or network", async () => {
  const store = new Memory();
  const result = await runComposioTest(env, store, "prepare", {
    fetchImpl: async () => {
      throw Error(sentinel);
    },
  });
  assert.equal(result.calls, 0);
  assert.equal(store.value, undefined);
});
test("prepare checks metadata and usage but does not execute Gmail or reveal private fields", async () => {
  const h = await harness();
  const r = await h.run("prepare");
  assert.equal(h.calls.length, 4);
  assert.equal(r.phase, "prepared");
  assert.equal(r.monthlyAllowanceExposedByApi, false);
  assert.ok(!JSON.stringify(r).includes(sentinel));
  assert.ok(!JSON.stringify(r).includes("fictional.test"));
  assert.ok(!JSON.stringify(r).includes("owner-0"));
  await h.run("prepare");
  assert.equal(h.calls.length, 4);
});
test("proxy execution is blocked until included allowance is confirmed", async () => {
  const h = await harness();
  await h.run("prepare");
  await assert.rejects(h.run("send"), /INCLUDED_ALLOWANCE/);
  assert.equal(h.calls.length, 4);
  assert.equal(h.store.value!.phase, "prepared");
});
test("configuration is validated before requests and cannot change under a run", async () => {
  const h = await harness();
  for (const bad of [
    { COMPOSIO_API_KEY: "bad\r\nkey" },
    { COMPOSIO_CONNECTED_ACCOUNT_2_ID: "ca_first" },
    { S00_TEST_RECIPIENT_EMAIL: "bad\r\nBcc:bad@test.test" },
  ])
    await assert.rejects(
      runComposioTest({ ...env, ...bad }, h.store, "prepare", {
        execute: true,
        fetchImpl: h.fetchImpl,
      }),
      /INVALID_CONFIGURATION/,
    );
  assert.equal(h.calls.length, 0);
  await h.run("prepare");
  await assert.rejects(
    runComposioTest(
      { ...env, S00_TEST_RECIPIENT_EMAIL: "another@fictional.test" },
      h.store,
      "send",
      { execute: true, fetchImpl: h.fetchImpl },
    ),
    /CONFIGURATION_CHANGED/,
  );
  assert.equal(h.calls.length, 4);
});
test("sending reserves before HTTP, uses exact accounts and cannot be replayed", async () => {
  const h = await harness();
  await h.run("prepare");
  const r = await h.run("send", true);
  assert.ok(r.mailboxes.every((b) => b.initial === "sent"));
  assert.equal(h.calls.length, 8);
  await h.run("send");
  assert.equal(h.calls.length, 8);
  assert.ok(h.sent.every((x) => x.length === 1));
});
test("effective profile mismatch stops all sends", async () => {
  const h = await harness();
  await h.run("prepare");
  await assert.rejects(
    h.run("send", true, async (input, init) =>
      String(input).endsWith("tools/execute/proxy")
        ? json({ status: 200, data: { emailAddress: "wrong@fictional.test" } })
        : h.fetchImpl(input, init),
    ),
    /PROFILE_MISMATCH/,
  );
  assert.ok(h.sent.every((x) => !x.length));
  assert.equal(h.store.value!.phase, "blocked");
});
test("uncertain sends remain reserved and cannot be retried", async () => {
  const h = await harness();
  await h.run("prepare");
  await assert.rejects(
    h.run("send", true, async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.method === "POST") throw Error(sentinel);
      return h.fetchImpl(input, init);
    }),
    /NETWORK_OR_TIMEOUT/,
  );
  assert.equal(h.store.value!.boxes[0].initial.status, "uncertain");
  const calls = h.calls.length;
  await assert.rejects(h.run("send", true), /RUN_BLOCKED/);
  assert.equal(h.calls.length, calls);
  assert.ok(!JSON.stringify(publicRunReport(h.store.value)).includes(sentinel));
});
test("a failed journal write prevents the HTTP send", async () => {
  const h = await harness();
  await h.run("prepare");
  const save = h.store.save.bind(h.store);
  h.store.save = async (state) => {
    if (state.boxes.some((b) => b.initial.status === "in_flight"))
      throw Error(sentinel);
    return save(state);
  };
  await assert.rejects(h.run("send", true), /JOURNAL_WRITE_FAILED/);
  assert.ok(h.sent.every((x) => !x.length));
});
test("roundtrip reads only the created threads, hashes both PDFs and confirms within each thread once", async () => {
  const h = await harness();
  await h.run("prepare");
  await h.run("send", true);
  h.replies();
  const r = await h.run("inspect");
  assert.ok(
    r.mailboxes.every((b) => b.responseDetected && b.attachmentHashVerified),
  );
  const calls = h.calls.length;
  await h.run("inspect");
  assert.equal(h.calls.length, calls);
  const confirmed = await h.run("confirm");
  assert.ok(
    confirmed.mailboxes.every(
      (b) => b.confirmation === "sent" && b.confirmationVerified,
    ),
  );
  const count = h.calls.length;
  await h.run("confirm");
  assert.equal(h.calls.length, count);
  await h.run("usage");
  assert.ok(h.calls.length <= 32);
  assert.ok(!JSON.stringify(confirmed).includes("fictional.test"));
  assert.ok(
    h.calls
      .filter((c) => c.body?.method === "POST")
      .every((c) => !c.body.connected_account_id.includes("instant")),
  );
});
test("wrong thread, unexpected sender and corrupted PDF stop without confirmations", async () => {
  for (const mutation of ["thread", "sender", "pdf"]) {
    const h = await harness();
    await h.run("prepare");
    await h.run("send", true);
    h.replies();
    await assert.rejects(
      h.run("inspect", false, async (input, init) => {
        const r = await h.fetchImpl(input, init);
        const b = await r.json();
        if (b.data?.messages) {
          if (mutation === "thread") b.data.id = "bad";
          if (mutation === "sender")
            b.data.messages.at(-1).payload.headers[0].value =
              "other@fictional.test";
        }
        if (mutation === "pdf" && b.data?.data)
          b.data.data = Buffer.from("bad").toString("base64url");
        return json(b);
      }),
      /WRONG_THREAD|UNEXPECTED_SENDER|ATTACHMENT_HASH_MISMATCH/,
    );
    assert.ok(h.sent.every((x) => x.length === 1));
  }
});
test("polling and cumulative request budget are bounded", async () => {
  const h = await harness();
  await h.run("prepare");
  await h.run("send", true);
  for (let i = 0; i < 7; i++) await h.run("inspect");
  await assert.rejects(h.run("inspect"), /POLL_LIMIT/);
  const other = await harness();
  await other.run("prepare");
  other.store.value!.calls = 32;
  await assert.rejects(other.run("usage"), /CALL_BUDGET/);
  assert.equal(other.calls.length, 4);
});
test("redirects, upstream errors and oversized payloads fail closed and redact provider text", async () => {
  for (const response of [
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://invalid.test/" },
      }),
    () => json({ error: sentinel }, 403),
    () => json({ data: sentinel.repeat(110000) }),
  ]) {
    const h = await harness();
    await assert.rejects(
      h.run("prepare", false, async () => response()),
      /HTTP_|RESPONSE_TOO_LARGE/,
    );
    assert.ok(
      !JSON.stringify(publicRunReport(h.store.value)).includes(sentinel),
    );
  }
});
test("MIME rejects header injection and preserves thread references", () => {
  assert.throws(
    () =>
      mime(
        identities[0],
        env.S00_TEST_RECIPIENT_EMAIL,
        "test\r\nBcc:bad",
        "body",
        "<a@test.test>",
      ),
    /INVALID_MIME/,
  );
  const raw = Buffer.from(
    mime(
      identities[0],
      env.S00_TEST_RECIPIENT_EMAIL,
      "same subject",
      "hello",
      "<a@test.test>",
      "<b@test.test>",
      ["<c@test.test>"],
    ),
    "base64url",
  ).toString("utf8");
  assert.ok(raw.includes("In-Reply-To: <b@test.test>"));
  assert.ok(raw.includes("References: <c@test.test> <b@test.test>"));
});
test("journal validation rejects unsafe state and CLI does not autoload env", async () => {
  const h = await harness();
  await h.run("prepare");
  assert.throws(
    () => validateRunState({ ...h.store.value, lastError: sentinel }),
    /INVALID_JOURNAL/,
  );
  const dir = await mkdtemp(resolve(tmpdir(), "s00-runner-"));
  try {
    await writeFile(resolve(dir, ".env.local"), "COMPOSIO_API_KEY=" + sentinel);
    const cli = resolve("scripts/pipeline-os/s00-composio-runner-cli.ts"),
      tsx = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
    const result = spawnSync(process.execPath, ["--import", tsx, cli], {
      cwd: dir,
      encoding: "utf8",
      env: {
        SystemRoot: process.env.SystemRoot,
        PATH: process.env.PATH,
        NODE_ENV: "test",
      },
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).calls, 0);
    assert.ok(!result.stdout.includes(sentinel));
    const bad = spawnSync(
      process.execPath,
      ["--import", tsx, cli, "--unknown-" + sentinel],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(bad.status, 2);
    assert.ok(!bad.stderr.includes(sentinel));
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep))
      throw Error("Unsafe temporary path");
    await rm(dir, { recursive: true, force: true });
  }
});

test("permission recovery rotates only the key and preserves token, budget and destination", async () => {
  const h = await harness();
  await h.run("prepare");
  const token = h.store.value!.token;
  await assert.rejects(
    h.run("send", true, async () =>
      json({ error: "missing proxy permission" }, 403),
    ),
    /HTTP_403/,
  );
  assert.equal(h.store.value!.calls, 5);
  assert.equal(h.store.value!.profilesVerified, false);
  const rotated = { ...env, COMPOSIO_API_KEY: "replacement-fixture-key" };
  const wrapped: typeof fetch = async (input, init) => {
    assert.equal(
      new Headers(init?.headers).get("x-api-key"),
      rotated.COMPOSIO_API_KEY,
    );
    const headers = new Headers(init?.headers);
    headers.set("x-api-key", sentinel);
    return h.fetchImpl(input, { ...init, headers });
  };
  await assert.rejects(
    runComposioTest(
      { ...rotated, S00_TEST_RECIPIENT_EMAIL: "changed@fictional.test" },
      h.store,
      "prepare",
      { execute: true, fetchImpl: wrapped },
    ),
    /CONFIGURATION_CHANGED/,
  );
  const recovered = await runComposioTest(rotated, h.store, "prepare", {
    execute: true,
    fetchImpl: wrapped,
  });
  assert.equal(recovered.token, token);
  assert.equal(recovered.calls, 9);
  assert.equal(recovered.phase, "prepared");
  assert.ok(h.sent.every((sent) => sent.length === 0));
  const sent = await runComposioTest(rotated, h.store, "send", {
    execute: true,
    includedCallsConfirmed: true,
    fetchImpl: wrapped,
  });
  assert.ok(sent.mailboxes.every((box) => box.initial === "sent"));
  assert.equal(sent.calls, 13);
});

test("permission recovery cannot reset sent or uncertain attempts, or an unbound legacy journal", async () => {
  for (const status of ["sent", "uncertain", "in_flight", "failed"] as const) {
    const h = await harness();
    await h.run("prepare");
    h.store.value!.phase = "blocked";
    h.store.value!.lastError = "HTTP_403";
    h.store.value!.boxes[0].initial.status = status;
    await assert.rejects(
      runComposioTest(
        { ...env, COMPOSIO_API_KEY: "replacement-fixture-key" },
        h.store,
        "prepare",
        { execute: true, fetchImpl: h.fetchImpl },
      ),
      /CONFIGURATION_CHANGED/,
    );
    assert.equal(h.calls.length, 4);
  }
  const h = await harness();
  await h.run("prepare");
  h.store.value!.phase = "blocked";
  h.store.value!.lastError = "HTTP_403";
  delete h.store.value!.targetFingerprint;
  await assert.rejects(h.run("prepare"), /JOURNAL_TARGET_BINDING_REQUIRED/);
  assert.equal(h.calls.length, 4);
});

test("a reply without an authored ACK does not download other PDFs or send confirmations", async () => {
  const h = await harness();
  await h.run("prepare");
  await h.run("send", true);
  h.replies();
  await assert.rejects(
    h.run("inspect", false, async (input, init) => {
      const response = await h.fetchImpl(input, init);
      const value = await response.json();
      if (value.data?.messages) {
        const reply = value.data.messages.at(-1);
        const expected = "S00 ACK S00-COMPOSIO-" + h.store.value!.token + "-M1";
        reply.payload.parts[0].body.data = Buffer.from(
          "Attached documents\n\n> " + expected,
        ).toString("base64url");
        reply.payload.parts[1].filename = "fictional-statement-a.pdf";
        reply.payload.parts[1].body.size = 4900000;
        reply.payload.parts.push({
          ...reply.payload.parts[1],
          filename: "fictional-statement-b.pdf",
          body: { attachmentId: "another", size: 5600000 },
        });
      }
      return json(value);
    }),
    /ACK_TOKEN_MISSING/,
  );
  assert.equal(
    h.calls.filter((c) => c.body?.endpoint?.includes("/attachments/")).length,
    0,
  );
  assert.ok(h.sent.every((messages) => messages.length === 1));
  assert.equal(h.store.value!.boxes[0].confirmation.status, "not_sent");
});

async function providedHarness() {
  const h = await harness();
  await h.run("prepare");
  await h.run("send", true);
  h.replies();
  const first = Buffer.concat([
    Buffer.from("%PDF-1.7\n"),
    Buffer.alloc(2_200_000, 65),
  ]);
  const second = Buffer.from("%PDF-1.7\nfictional opaque bytes only\n%%EOF\n");
  let downloads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (body.endpoint?.includes("/attachments/provided_")) {
      downloads++;
      const data = body.endpoint.endsWith("provided_a") ? first : second;
      return json({
        status: 200,
        data: { size: data.length, data: data.toString("base64url") },
      });
    }
    const response = await h.fetchImpl(input, init);
    const result = await response.json();
    if (result.data?.messages) {
      const reply = result.data.messages.at(-1);
      reply.payload.parts = [
        {
          mimeType: "text/plain",
          body: { data: "ignored-not-base64-user-body" },
        },
        {
          mimeType: "application/pdf",
          filename: sentinel + "-a.pdf",
          body: { attachmentId: "provided_a", size: first.length },
        },
        {
          mimeType: "application/pdf",
          filename: sentinel + "-b.pdf",
          body: { attachmentId: "provided_b", size: second.length },
        },
      ];
    }
    return json(result);
  };
  const run = (
    action: Parameters<typeof runComposioTest>[2],
    authorized = false,
    override?: typeof fetch,
  ) =>
    runComposioTest(env, h.store, action, {
      execute: true,
      providedPdfsAuthorized: authorized,
      fetchImpl: override ?? fetchImpl,
    });
  return {
    ...h,
    first,
    second,
    fetchProvided: fetchImpl,
    runProvided: run,
    downloads: () => downloads,
  };
}

test("authorized supplied PDFs resume the same run without ACK, without storing bodies, and confirm honestly", async () => {
  const h = await providedHarness();
  const token = h.store.value!.token;
  h.store.value!.phase = "blocked";
  h.store.value!.lastError = "ACK_TOKEN_MISSING";
  h.store.value!.calls = 20;
  h.store.value!.boxes[0].polls = 1;
  const result = await h.runProvided("inspect", true);
  assert.equal(result.token, token);
  assert.equal(result.calls, 26);
  assert.equal(result.maxCalls, 40);
  assert.equal(result.mailboxes[0].polls, 2);
  assert.ok(
    result.mailboxes.every(
      (b) =>
        b.receivedPdfCount === 2 &&
        !b.sourceHashCompared &&
        !b.attachmentHashVerified &&
        b.attachmentVerification === "bytes_size_signature_sha256" &&
        !b.pdfContentAnalyzed,
    ),
  );
  assert.ok(
    result.mailboxes.every(
      (b) => b.receivedPdfBytes === h.first.length + h.second.length,
    ),
  );
  assert.equal(h.downloads(), 4);
  assert.doesNotThrow(() => validateRunState(h.store.value));
  assert.ok(!JSON.stringify(h.store.value).includes("ignored-not-base64"));
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.ok(!JSON.stringify(h.store.value).includes(sentinel));
  const confirmed = await h.runProvided("confirm");
  assert.equal(confirmed.calls, 32);
  assert.ok(confirmed.mailboxes.every((b) => b.confirmationVerified));
  await h.runProvided("usage");
  const calls = h.store.value!.calls;
  assert.equal(calls, 33);
  await h.runProvided("inspect");
  await h.runProvided("confirm");
  assert.equal(h.store.value!.calls, calls);
  assert.ok(h.sent.every((messages) => messages.length === 2));
});

test("provided PDF mode requires explicit authorization and safe initial-send state", async () => {
  const h = await providedHarness();
  await assert.rejects(h.runProvided("inspect"), /ACK_TOKEN_MISSING/);
  assert.equal(h.downloads(), 0);
  assert.equal(h.store.value!.attachmentPolicy, undefined);
  await assert.rejects(
    runComposioTest(
      { ...env, S00_TEST_RECIPIENT_EMAIL: "changed@fictional.test" },
      h.store,
      "inspect",
      {
        execute: true,
        providedPdfsAuthorized: true,
        fetchImpl: h.fetchProvided,
      },
    ),
    /CONFIGURATION_CHANGED/,
  );
  assert.equal(h.store.value!.attachmentPolicy, undefined);
  for (const mutation of ["uncertain", "wrong_error", "confirmation"]) {
    const p = await providedHarness();
    if (mutation === "uncertain")
      p.store.value!.boxes[0].initial.status = "uncertain";
    if (mutation === "wrong_error") {
      p.store.value!.phase = "blocked";
      p.store.value!.lastError = "UNEXPECTED_SENDER";
    }
    if (mutation === "confirmation")
      p.store.value!.boxes[0].confirmation.status = "in_flight";
    await assert.rejects(
      p.runProvided("inspect", true),
      /UNSAFE_ATTACHMENT_POLICY_TRANSITION/,
    );
    assert.equal(p.downloads(), 0);
    assert.equal(p.store.value!.attachmentPolicy, undefined);
  }
});

test("provided PDF metadata count and 10 MB limit are checked before downloading", async () => {
  for (const mutation of ["large", "many"]) {
    const h = await providedHarness();
    await assert.rejects(
      h.runProvided("inspect", true, async (input, init) => {
        const response = await h.fetchProvided(input, init);
        const value = await response.json();
        if (value.data?.messages) {
          const parts = value.data.messages.at(-1).payload.parts;
          if (mutation === "large") parts[1].body.size = 10_000_001;
          else
            parts.push({
              ...parts[1],
              filename: "third.pdf",
              body: { attachmentId: "third", size: 100 },
            });
        }
        return json(value);
      }),
      /INVALID_ATTACHMENT_METADATA|EXPECTED_PDF_MISSING_OR_COUNT/,
    );
    assert.equal(h.downloads(), 0);
    assert.ok(h.sent.every((messages) => messages.length === 1));
  }
});

test("provided PDF bytes must match MIME/API sizes and PDF signature", async () => {
  for (const mutation of ["size", "bytes", "signature"]) {
    const h = await providedHarness();
    await assert.rejects(
      h.runProvided("inspect", true, async (input, init) => {
        const response = await h.fetchProvided(input, init);
        const value = await response.json();
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.endpoint?.includes("/attachments/")) {
          if (mutation === "size") value.data.size++;
          if (mutation === "bytes")
            value.data.data = Buffer.from("wrong").toString("base64url");
          if (mutation === "signature") {
            const bytes = Buffer.from(h.first);
            bytes.write("WRONG");
            value.data.data = bytes.toString("base64url");
          }
        }
        return json(value);
      }),
      /ATTACHMENT_SIZE_MISMATCH|PDF_SIGNATURE_MISMATCH/,
    );
    assert.ok(h.sent.every((messages) => messages.length === 1));
    assert.ok(
      !JSON.stringify(publicRunReport(h.store.value)).includes(sentinel),
    );
  }
});

test("40-call extension preserves budget and rejects modified journal verification", async () => {
  const h = await providedHarness();
  await h.runProvided("inspect", true);
  const invalid = structuredClone(h.store.value!);
  invalid.boxes[0].response!.attachments![0].bytes = 10_000_001;
  assert.throws(() => validateRunState(invalid), /INVALID_JOURNAL/);
  assert.throws(
    () => validateRunState({ ...h.store.value, attachmentPolicy: "unbounded" }),
    /INVALID_JOURNAL/,
  );
  h.store.value!.priorDiagnosticCalls = 4;
  h.store.value!.calls = 36;
  assert.equal(publicRunReport(h.store.value).calls, 40);
  assert.equal(publicRunReport(h.store.value).runnerCalls, 36);
  assert.throws(
    () => validateRunState({ ...h.store.value, priorDiagnosticCalls: 5 }),
    /INVALID_JOURNAL/,
  );
  const downloads = h.downloads();
  await assert.rejects(h.runProvided("usage"), /CALL_BUDGET_EXHAUSTED/);
  assert.equal(h.downloads(), downloads);
  assert.equal(h.store.value!.calls, 36);
});
