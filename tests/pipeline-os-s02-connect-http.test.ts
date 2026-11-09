import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectHttpFixture } from "./fixtures/pipeline-os-s02-connect-http";
import { createHttpCorrelation } from "../src/lib/server/mail-accounts/composio-connect/http-correlation";
import {
  connectReturnAttempt,
  connectViewHttp,
} from "../src/lib/composio-connect-http";
test("HTTP correlation is deterministic per actor/session/receipt and domain separated", () => {
  const f = createHttpCorrelation(Buffer.alloc(32, 17)),
    session = { actor_id: randomUUID(), session_id: randomUUID() },
    key = randomUUID(),
    a = f(session, key);
  assert.deepEqual(f(session, key), a);
  assert.notEqual(
    f({ ...session, session_id: randomUUID() }, key).proof,
    a.proof,
  );
  assert.notEqual(a.proof, a.state.split("_").at(-1));
  assert.equal(
    connectReturnAttempt(new URLSearchParams({ composio_connect: a.id })),
    a.id,
  );
  assert.equal(
    connectReturnAttempt(
      new URLSearchParams(`composio_connect=${a.id}&composio_connect=${a.id}`),
    ),
    null,
  );
});
test("HTTP feature off denies mutations and reads no configuration/RPC/provider", async () => {
  const f = await connectHttpFixture();
  try {
    f.disable();
    const r = await f.options();
    assert.equal(r.status, 200);
    assert.equal((await r.json()).enabled, false);
    assert.equal((await f.begin({})).status, 503);
    assert.equal(f.configCalls, 0);
    assert.equal(f.rpcCalls, 0);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.db.close();
  }
});
test("HTTP origin, shape, foreign session and absent cookie deny before provider", async () => {
  const f = await connectHttpFixture();
  try {
    assert.equal(
      (await f.begin(await f.intent(), { Origin: "https://foreign.test" }))
        .status,
      403,
    );
    assert.equal(
      (await f.begin({ ...(await f.intent()), api_key: "forbidden" })).status,
      400,
    );
    assert.equal(
      (await f.begin(await f.intent({ organization: "not-permitted" }))).status,
      400,
    );
    const begun = await f.begin(await f.intent());
    assert.equal(begun.status, 200, await begun.clone().text());
    const v = connectViewHttp.parse(await begun.json()),
      id = v.status!.id;
    const saved = f.cookies.get("__Host-crm-connect-" + id)!;
    f.cookies.clear();
    assert.equal((await f.status(id)).status, 403);
    f.cookies.set("__Host-crm-connect-" + id, saved);
    f.session.session_id = randomUUID();
    assert.equal((await f.status(id)).status, 403);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.db.close();
  }
});
test("HTTP full offline flow: begin ACK replay, secure cookie, POST navigation, callback replay, B1 adopt and candidate", async () => {
  const f = await connectHttpFixture();
  try {
    const body = await f.intent(),
      begun = await f.begin(body);
    assert.equal(begun.status, 200, await begun.clone().text());
    const initial = connectViewHttp.parse(await begun.json()),
      id = initial.status!.id;
    const replay = await f.begin(body);
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal((await replay.json()).status.id, id);
    assert.equal(f.calls.length, 0);
    const cookie = f.cookies.get("__Host-crm-connect-" + id)!;
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.sameSite, "lax");
    assert.equal(cookie.options.path, "/");
    assert(!("domain" in cookie.options));
    const command = {
      expected_revision: initial.status!.revision,
      idempotency_key: randomUUID(),
    };
    const started = await f.action(id, "start", command);
    assert.equal(started.status, 200, await started.clone().text());
    const waiting = connectViewHttp.parse(await started.json());
    assert.equal(waiting.status!.state, "awaiting_consent");
    assert.equal((await f.action(id, "start", command)).status, 200);
    assert.equal(f.calls.length, 1);
    const safe = JSON.stringify(waiting);
    for (const secret of [
      f.cookie(id).proof,
      "connect.composio.dev",
      "ciphertext",
      "api_key",
    ])
      assert(!safe.includes(secret));
    assert.equal(
      (await f.action(id, "resume", "", { Origin: "https://foreign.test" }))
        .status,
      403,
    );
    const nav = await f.action(id, "resume", "");
    assert.equal(nav.status, 303);
    assert.match(
      nav.headers.get("Location")!,
      /^https:\/\/connect\.composio\.dev\/link\//,
    );
    assert.equal(nav.headers.get("Referrer-Policy"), "no-referrer");
    await f.owner();
    const state = await f.scalar<string>(
      "select state_hash v from composio_connect.attempts where id=$1",
      [id],
    );
    assert.notEqual(state, f.cookie(id).proof);
    const material = f.config.material(f.session, body.idempotency_key),
      connection = "ca_" + id.replaceAll("-", "");
    const callbackUrl =
      f.origin +
      "/api/mail/composio/connect/callback?" +
      new URLSearchParams({
        state: material.state,
        status: "success",
        connected_account_id: connection,
      });
    assert.equal(
      (await f.callback(callbackUrl + "&state=duplicate")).status,
      400,
    );
    const completed = await f.callback(callbackUrl);
    assert.equal(completed.status, 303, await completed.clone().text());
    assert.equal(
      new URL(completed.headers.get("Location")!).searchParams.get(
        "composio_connect",
      ),
      id,
    );
    assert.equal(f.calls.length, 4);
    assert.equal((await f.callback(callbackUrl)).status, 303);
    assert.equal(f.calls.length, 4);
    const pending = await f.status(id);
    assert.equal(pending.status, 200, await pending.clone().text());
    const review = connectViewHttp.parse(await pending.json());
    assert.equal(review.status!.state, "awaiting_brand");
    assert(review.pending);
    const row = await f.scalar<{
      revision: number;
      expected_account_revision: number;
    }>("select to_jsonb(r) v from mail_account_brand_reviews r where id=$1", [
      review.pending.review_id,
    ]);
    await f.human();
    await f.brandCommand("brand_mapping_confirm", {
      review_id: review.pending.review_id,
      expected_review_revision: row.revision,
      expected_account_revision: row.expected_account_revision,
      acknowledge_conflict: false,
    });
    const stale = await f.status(id);
    assert.equal(stale.status, 200, await stale.clone().text());
    assert.equal((await stale.json()).context_changed, true);
    const adopted = await f.action(id, "adopt", {
      idempotency_key: randomUUID(),
    });
    assert.equal(adopted.status, 200, await adopted.clone().text());
    const ready = connectViewHttp.parse(await adopted.json());
    assert.equal(ready.status!.next, "register_candidate");
    const registered = await f.action(id, "register", {
      expected_revision: ready.status!.revision,
      idempotency_key: randomUUID(),
    });
    assert.equal(registered.status, 200, await registered.clone().text());
    assert.equal((await registered.json()).status.state, "completed");
    await f.owner();
    const account = ready.status!.account_id;
    assert.equal(
      await f.scalar("select status v from mail_accounts where id=$1", [
        account,
      ]),
      "disconnected",
    );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_permissions where account_id=$1",
        [account],
      ),
      0,
    );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_runtime.routes where account_id=$1",
        [account],
      ),
      0,
    );
    assert.equal(f.calls.length, 4);
  } finally {
    await f.db.close();
  }
});
test("HTTP wrong primary mailbox redirects to a safe result and never materializes a candidate", async () => {
  const f = await connectHttpFixture();
  try {
    const body = await f.intent(),
      r = await f.begin(body),
      first = await r.json(),
      id = first.status.id;
    await f.action(id, "start", {
      expected_revision: 0,
      idempotency_key: randomUUID(),
    });
    f.wrongMailbox();
    const state = f.config.material(f.session, body.idempotency_key).state;
    const response = await f.callback(
      f.origin +
        "/api/mail/composio/connect/callback?" +
        new URLSearchParams({
          state,
          status: "success",
          connected_account_id: "ca_" + id.replaceAll("-", ""),
        }),
    );
    assert.equal(response.status, 303);
    assert.equal(
      new URL(response.headers.get("Location")!).searchParams.get(
        "connect_error",
      ),
      "CONNECT_IDENTITY_MISMATCH",
    );
    await f.owner();
    assert.equal(
      await f.scalar("select count(*)::int v from mail_accounts where id=$1", [
        first.status.account_id,
      ]),
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("HTTP unknown creation cannot be repeated and cookie expiry does not extend", async () => {
  const f = await connectHttpFixture();
  try {
    const r = await f.begin(await f.intent()),
      first = await r.json(),
      id = first.status.id,
      max = f.cookies.get("__Host-crm-connect-" + id)!.options.maxAge as number;
    f.advance(1000);
    assert.equal((await f.status(id)).status, 200);
    assert(
      (f.cookies.get("__Host-crm-connect-" + id)!.options.maxAge as number) <
        max,
    );
    f.failNetwork();
    const command = { expected_revision: 0, idempotency_key: randomUUID() };
    const failed = await f.action(id, "start", command);
    assert.equal(failed.status, 409);
    assert.equal((await failed.json()).code, "CONNECT_NEEDS_RECONCILIATION");
    await f.action(id, "start", command);
    assert.equal(f.calls.length, 1);
    f.advance(700000);
    assert.equal((await f.status(id)).status, 409);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.db.close();
  }
});
