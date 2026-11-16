import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  connectAttemptHref,
  connectReturnAttempt,
  connectViewHttp,
} from "../src/lib/composio-connect-http";
import { connectV2Fixture } from "./fixtures/pipeline-os-s02-connect-v2";

test("REC01: prepared attempt reference survives reload without mailbox or provider material", () => {
  const id = randomUUID();
  const href = connectAttemptHref(
    "https://crm.fixture.test/?module=connections&tab=composio#connect",
    id,
  );
  const url = new URL(href, "https://crm.fixture.test");
  assert.equal(connectReturnAttempt(url.searchParams), id);
  assert.equal(url.searchParams.get("module"), "connections");
  assert.equal(url.hash, "#connect");
  assert.equal(href.startsWith("/?"), true);
  assert.deepEqual(
    [...url.searchParams.keys()],
    ["module", "tab", "composio_connect"],
  );
});

test("REC02: explicit reset clears attempt and stale callback error, preserving CRM navigation", () => {
  const id = randomUUID();
  const href = connectAttemptHref(
    `/?module=connections&composio_connect=${id}&connect_error=CONNECT_CLOSED#connect`,
    null,
  );
  assert.equal(href, "/?module=connections#connect");
  assert.equal(
    connectReturnAttempt(
      new URL(href, "https://crm.fixture.test").searchParams,
    ),
    null,
  );
});

test("REC03: invalid references are rejected and duplicate callback arguments cannot be resumed", () => {
  for (const id of [
    "",
    "//external.invalid",
    "not-an-id",
    randomUUID() + "&token=secret",
  ])
    assert.throws(() => connectAttemptHref("/?module=connections", id));
  const id = randomUUID();
  assert.equal(
    connectReturnAttempt(
      new URLSearchParams(`composio_connect=${id}&composio_connect=${id}`),
    ),
    null,
  );
  const normalized = new URL(
    connectAttemptHref(
      `/?composio_connect=invalid&composio_connect=invalid`,
      id,
    ),
    "https://crm.fixture.test",
  );
  assert.equal(normalized.searchParams.getAll("composio_connect").length, 1);
});

test("REC04: active v2 conflict can resume only in original browser/session without recreating provider link", async () => {
  const f = await connectV2Fixture();
  try {
    const intent = await f.newIntent();
    const begin = await f.begin(intent);
    assert.equal(begin.status, 200);
    const attempt = connectViewHttp.parse(await begin.json()).status!;
    const start = await f.action(attempt.id, "start", {
      expected_revision: attempt.revision,
      idempotency_key: randomUUID(),
    });
    assert.equal(start.status, 200);
    assert.equal((await start.json()).status.state, "awaiting_consent");
    const duplicate = await f.begin({
      ...intent,
      idempotency_key: randomUUID(),
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, "CONNECT_CONFLICT");
    assert.equal(f.calls.length, 1);
    const reference = connectReturnAttempt(
      new URL(connectAttemptHref(f.origin, attempt.id), f.origin).searchParams,
    )!;
    const cookie = f.cookies.get("__Host-crm-connect-" + reference)!;
    f.cookies.clear();
    assert.equal((await f.status(reference)).status, 403);
    f.cookies.set("__Host-crm-connect-" + reference, cookie);
    const session = f.session.session_id;
    f.session.session_id = randomUUID();
    assert.equal((await f.status(reference)).status, 403);
    f.session.session_id = session;
    const recovered = await f.status(reference);
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).status.next, "resume");
    assert.equal(f.calls.length, 1);
  } finally {
    await f.db.close();
  }
});

test("REC05: expired receipt does not silently retry; explicit fresh preparation preserves prior evidence", async () => {
  const f = await connectV2Fixture();
  try {
    const intent = await f.newIntent();
    const begin = await f.begin(intent);
    const attempt = connectViewHttp.parse(await begin.json()).status!;
    assert.equal(
      (
        await f.action(attempt.id, "start", {
          expected_revision: attempt.revision,
          idempotency_key: randomUUID(),
        })
      ).status,
      200,
    );
    await f.owner();
    await f.db.query(
      "update composio_connect.attempts set created_at=clock_timestamp()-interval '20 minutes',deadline=clock_timestamp()-interval '11 minutes' where id=$1",
      [attempt.id],
    );
    const staleReceipt = await f.begin(intent);
    assert.equal(staleReceipt.status, 409);
    assert.equal((await staleReceipt.json()).code, "CONNECT_CLOSED");
    assert.equal(f.calls.length, 1);
    const fresh = await f.begin({ ...intent, idempotency_key: randomUUID() });
    assert.equal(fresh.status, 200, await fresh.clone().text());
    assert.notEqual((await fresh.json()).status.id, attempt.id);
    await f.owner();
    assert.deepEqual(
      await f.scalar(
        "select jsonb_build_object('state',state,'cleanup',cleanup_required,'connection',connection_id is not null) v from composio_connect.attempts where id=$1",
        [attempt.id],
      ),
      { state: "expired", cleanup: true, connection: true },
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.db.close();
  }
});
