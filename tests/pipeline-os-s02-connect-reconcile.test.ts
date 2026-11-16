import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { connectV2Fixture } from "./fixtures/pipeline-os-s02-connect-v2";
import { connectViewHttp } from "../src/lib/composio-connect-http";
import { GET, POST } from "../src/app/api/mail/composio/connect/recovery/route";
import {
  GET as candidateGet,
  POST as candidatePost,
} from "../src/app/api/mail/composio/connect/recovery/candidate/route";

const directory =
  "docs/specs/pipeline-os/s02/connect-gmail/reconcile-20261116/";
async function fixture() {
  const f = await connectV2Fixture();
  try {
    await f.owner();
    await f.db.exec(await readFile(directory + "recovery.delta.sql", "utf8"));
    const originalUser = f.p.user,
      originalService = f.p.service;
    const recoveryRpcErrors: string[] = [];
    const rpc = async (
      human: boolean,
      name: string,
      args: Record<string, unknown>,
    ) => {
      try {
        if (human) await f.human();
        else await f.service();
        const values = name.endsWith("_candidate")
          ? [args.source, args.expected, args.request_key]
          : name.endsWith("_list")
            ? []
            : name.endsWith("_authorize")
              ? [args.operation, args.p]
              : [args.operation, args.p, args.ticket];
        return {
          data: await f.scalar(
            `select public.${name}(${values.map((_, i) => "$" + (i + 1)).join(",")}) v`,
            values,
          ),
          error: null,
        };
      } catch (e) {
        recoveryRpcErrors.push((e as Error).message);
        return { data: null, error: { message: (e as Error).message } };
      }
    };
    f.p.user = async () => {
      const user = await originalUser();
      const original = user.db;
      return {
        ...user,
        db: {
          rpc: (name: string, args: Record<string, unknown>) =>
            name.startsWith("composio_connect_recovery_")
              ? rpc(true, name, args)
              : original.rpc(name, args),
        } as typeof original,
      };
    };
    f.p.service = () => ({
      rpc: (name, args) =>
        name.startsWith("composio_connect_recovery_")
          ? rpc(false, name, args)
          : originalService().rpc(name, args),
    });
    const body = await f.newIntent(),
      begun = await f.begin(body);
    assert.equal(begun.status, 200);
    const a = connectViewHttp.parse(await begun.json()).status!;
    assert.equal(
      (
        await f.action(a.id, "start", {
          expected_revision: a.revision,
          idempotency_key: randomUUID(),
        })
      ).status,
      200,
    );
    await f.owner();
    await f.db.query(
      "update composio_connect.attempts set created_at=clock_timestamp()-interval '20 minutes',deadline=clock_timestamp()-interval '11 minutes' where id=$1",
      [a.id],
    );
    const snapshot = await f.scalar<any>(
      "select jsonb_build_object('deadline',deadline,'connection_id',connection_id,'created_at',created_at,'revision',revision) v from composio_connect.attempts where id=$1",
      [a.id],
    );
    const command = {
      source_id: a.id,
      expected_revision: snapshot.revision,
      idempotency_key: randomUUID(),
    };
    const run = (p: unknown = command, headers?: Record<string, string>) =>
      f.run(() =>
        POST(f.request("/api/mail/composio/connect/recovery", p, headers)),
      );
    const list = () =>
      f.run(() => GET(f.request("/api/mail/composio/connect/recovery")));
    return {
      ...f,
      a,
      snapshot,
      command,
      recover: run,
      list,
      recoveryRpcErrors,
    };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}

test("RECON01: expired connection is verified once, original deadline preserved, brand review continues without Google", async () => {
  const f = await fixture();
  try {
    const listed = await f.list();
    assert.equal(listed.status, 200, await listed.clone().text());
    assert.equal((await listed.json()).items.length, 1);
    const response = await f.recover();
    assert.equal(response.status, 200, await response.clone().text());
    const v = connectViewHttp.parse(await response.json());
    assert.equal(v.status?.state, "awaiting_brand");
    assert.equal(v.status?.composio_enabled, false);
    assert.notEqual(v.status?.id, f.a.id);
    assert.equal(f.calls.length, 4);
    assert.equal(f.calls.filter((c) => c.path.endsWith("/link")).length, 1);
    const repeated = await f.recover();
    assert.equal(repeated.status, 200, await repeated.clone().text());
    assert.equal(f.calls.length, 4);
    await f.owner();
    const original = await f.scalar<any>(
      "select jsonb_build_object('deadline',deadline,'connection_id',connection_id,'created_at',created_at,'state',state) v from composio_connect.attempts where id=$1",
      [f.a.id],
    );
    assert.equal(original.deadline, f.snapshot.deadline);
    assert.equal(original.created_at, f.snapshot.created_at);
    assert.equal(original.connection_id, f.snapshot.connection_id);
    assert.equal(original.state, "expired");
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_recovery.runs where state='completed' and admitted_at is not null",
      ),
      1,
    );
    assert.equal(
      await f.scalar("select count(*)::int v from mail_runtime.routes"),
      0,
    );
    // Re-list can reconstruct the current session's continuation cookie after a lost POST response.
    f.cookies.clear();
    const list = await f.list();
    assert.equal(list.status, 200);
    assert.equal((await f.status(v.status!.id)).status, 200);
  } finally {
    await f.db.close();
  }
});

test("RECON02: bad origin and client connection substitution are rejected before provider access", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.recover(f.command, { origin: "https://foreign.invalid" }))
        .status,
      403,
    );
    assert.equal(
      (await f.recover({ ...f.command, connected_account_id: "ca_foreign" }))
        .status,
      400,
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.db.close();
  }
});

test("RECON03: wrong Gmail does not materialize; failed reconciliation never retries", async () => {
  const f = await fixture();
  try {
    f.wrongMailbox();
    assert.equal((await f.recover()).status, 409);
    const count = f.calls.length;
    assert.equal((await f.recover()).status, 409);
    assert.equal(f.calls.length, count);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_recovery.runs where state='failed'",
      ),
      1,
    );
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_connect.subjects where account_id is not null",
      ),
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("RECON04: revision drift and a still-live original attempt cannot be reconciled", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.recover({
          ...f.command,
          expected_revision: f.command.expected_revision + 1,
        })
      ).status,
      409,
    );
    await f.owner();
    await f.db.query(
      "update composio_connect.attempts set created_at=clock_timestamp(),deadline=clock_timestamp()+interval '9 minutes' where id=$1",
      [f.a.id],
    );
    assert.equal((await f.recover()).status, 409);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.db.close();
  }
});

test("RECON05: tables and service executor closed to human/anon; empty rollback is exact", async () => {
  const f = await connectV2Fixture();
  try {
    await f.owner();
    await f.db.exec(await readFile(directory + "recovery.delta.sql", "utf8"));
    assert.equal(
      await f.scalar(
        "select has_table_privilege('authenticated','composio_recovery.runs','SELECT') v",
      ),
      false,
    );
    assert.equal(
      await f.scalar(
        "select has_function_privilege('authenticated','public.composio_connect_recovery_execute(text,jsonb,jsonb)','EXECUTE') v",
      ),
      false,
    );
    assert.equal(
      await f.scalar(
        "select has_function_privilege('anon','public.composio_connect_recovery_authorize(text,jsonb)','EXECUTE') v",
      ),
      false,
    );
    await f.db.exec(
      await readFile(directory + "recovery.rollback.sql", "utf8"),
    );
    assert.equal(
      await f.scalar("select to_regnamespace('composio_recovery') is null v"),
      true,
    );
  } finally {
    await f.db.close();
  }
});

test("RECON06: lost MFA and disabled actor cannot issue a recovery", async () => {
  const f = await fixture();
  try {
    f.session.aal = "aal1" as typeof f.session.aal;
    assert.equal((await f.recover()).status, 403);
    assert.equal((await f.list()).status, 403);
    f.session.aal = "aal2";
    await f.owner();
    await f.db.query("update profiles set active=false where id=$1", [
      f.session.actor_id,
    ]);
    assert.equal((await f.recover()).status, 403);
    assert.equal(f.calls.length, 1);
  } finally {
    await f.db.close();
  }
});

test("RECON07: policy closure, brand drift and changed config stop before provider", async () => {
  for (const mutation of [
    "update mail_quota.head set closed=true where id=1",
    "update operating_brands set revision=revision+1",
    "update composio_connect.configuration set generation=generation+1 where id=1",
  ]) {
    const f = await fixture();
    try {
      await f.owner();
      await f.db.exec(mutation);
      assert.equal((await f.recover()).status, 409);
      assert.equal(f.calls.length, 1);
    } finally {
      await f.db.close();
    }
  }
});

test("RECON08: foreign connected-account owner stops before Gmail quota and retry is forbidden", async () => {
  const f = await fixture();
  try {
    const original = f.p.fetchImpl;
    f.p.fetchImpl = async (input, init) => {
      const r = await original(input, init);
      if (!String(input).includes("/connected_accounts/ca_")) return r;
      const wire = await r.json();
      wire.user_id = "foreign_owner";
      return Response.json(wire);
    };
    assert.equal((await f.recover()).status, 503);
    assert.equal(f.calls.length, 2);
    assert.equal((await f.recover()).status, 409);
    assert.equal(f.calls.length, 2);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_recovery.runs where reserved_at is not null",
      ),
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("RECON09: policy revocation between metadata reads blocks profile and materialization", async () => {
  const f = await fixture();
  try {
    const original = f.p.fetchImpl;
    f.p.fetchImpl = async (input, init) => {
      const r = await original(input, init);
      if (String(input).includes("/auth_configs/")) {
        await f.owner();
        await f.db.exec("update mail_quota.head set closed=true where id=1");
      }
      return r;
    };
    assert.equal((await f.recover()).status, 503);
    assert.equal(f.calls.filter((c) => c.path.endsWith("/proxy")).length, 0);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from composio_connect.subjects where account_id is not null",
      ),
      0,
    );
  } finally {
    await f.db.close();
  }
});

async function registrationFixture(confirm = true) {
  const f = await fixture();
  try {
    const response = await f.recover();
    assert.equal(response.status, 200);
    const view = connectViewHttp.parse(await response.json());
    await f.owner();
    await f.db.exec(
      await readFile(
        "docs/specs/pipeline-os/s02/connect-gmail/registration-20261116/registration.sql",
        "utf8",
      ),
    );
    const review = await f.scalar<any>(
      "select to_jsonb(r) v from mail_account_brand_reviews r where id=$1",
      [view.pending!.review_id],
    );
    if (confirm) {
      await f.human();
      await f.brandCommand("brand_mapping_confirm", {
        review_id: review.id,
        expected_review_revision: review.revision,
        expected_account_revision: review.expected_account_revision,
        acknowledge_conflict: false,
      });
    }
    await f.owner();
    await f.db.query(
      "update composio_connect.attempts set deadline=created_at where id=$1",
      [view.status!.id],
    );
    const get = () =>
      f.run(() =>
        candidateGet(
          new Request(
            f.origin +
              "/api/mail/composio/connect/recovery/candidate?source_id=" +
              f.a.id,
          ),
        ),
      );
    const post = (
      expected: unknown,
      key = randomUUID(),
      headers?: Record<string, string>,
    ) =>
      f.run(() =>
        candidatePost(
          f.request(
            "/api/mail/composio/connect/recovery/candidate",
            { source_id: f.a.id, expected, idempotency_key: key },
            headers,
          ),
        ),
      );
    return { ...f, get, post, childId: view.status!.id };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}
test("REG01: fresh human approval registers a candidate after expiry without provider or transport", async () => {
  const f = await registrationFixture();
  try {
    const prepared = await f.get();
    assert.equal(prepared.status, 200, await prepared.clone().text());
    const p = await prepared.json();
    const key = randomUUID();
    const calls = f.calls.length;
    const saved = await f.post(p.expected, key);
    assert.equal(
      saved.status,
      200,
      (await saved.clone().text()) + JSON.stringify(f.recoveryRpcErrors),
    );
    assert.equal((await saved.json()).state, "candidate");
    assert.equal((await f.post(p.expected, key)).status, 200);
    assert.equal(f.calls.length, calls);
    await f.owner();
    assert.equal(
      await f.scalar(
        "select count(*)::int v from mail_provider_bindings where status='candidate'",
      ),
      1,
    );
    assert.equal(
      await f.scalar(
        "select deadline=created_at v from composio_connect.attempts where id=$1",
        [f.childId],
      ),
      true,
    );
    assert.equal(
      await f.scalar("select count(*)::int v from mail_runtime.routes"),
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("REG02: pending brand, bad origin and missing MFA remain closed", async () => {
  const f = await registrationFixture(false);
  try {
    assert.equal((await f.get()).status, 409);
    assert.equal(
      (await f.post({}, randomUUID(), { origin: "https://foreign.invalid" }))
        .status,
      403,
    );
    f.session.aal = "aal1" as typeof f.session.aal;
    assert.equal((await f.get()).status, 403);
    await f.owner();
    assert.equal(
      await f.scalar("select count(*)::int v from mail_provider_bindings"),
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("REG03: changed approval snapshot and closed policy cannot register", async () => {
  const f = await registrationFixture();
  try {
    const p = await (await f.get()).json();
    assert.equal(
      (await f.post({ ...p.expected, review_revision: 999 })).status,
      409,
    );
    await f.owner();
    await f.db.exec("update mail_quota.head set closed=true where id=1");
    assert.equal((await f.post(p.expected)).status, 409);
    await f.owner();
    assert.equal(
      await f.scalar("select count(*)::int v from mail_provider_bindings"),
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("REG04: candidate approval has no anon/service entry point and revocation cannot be overwritten", async () => {
  const f = await registrationFixture();
  try {
    await f.owner();
    assert.equal(
      await f.scalar(
        "select has_function_privilege('anon','public.composio_connect_recovery_candidate(uuid,jsonb,uuid)','EXECUTE') v",
      ),
      false,
    );
    assert.equal(
      await f.scalar(
        "select has_function_privilege('service_role','public.composio_connect_recovery_candidate(uuid,jsonb,uuid)','EXECUTE') v",
      ),
      false,
    );
    const p = await (await f.get()).json(),
      key = randomUUID();
    assert.equal((await f.post(p.expected, key)).status, 200);
    assert.equal((await f.post(p.expected, randomUUID())).status, 409);
  } finally {
    await f.db.close();
  }
});
