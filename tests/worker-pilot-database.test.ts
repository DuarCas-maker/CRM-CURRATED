import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { c1Fixture } from "./fixtures/pipeline-os-s02-composio-bindings";
import { queueFixtureMail } from "./fixtures/pipeline-os-s02-brand-delivery";

test("worker pilot SQL: exact claim, durable budgets, holds and least privilege", async (t) => {
  const f = await c1Fixture(false),
    { db, accounts, users, queued, opportunity, brandA } = f;
  const owner = () => db.exec("reset role;set request.jwt.claims='{}'");
  const service = async () => {
    await owner();
    await db.exec("set role service_role");
  };
  const scalar = async <T>(sql: string, values: unknown[] = []) =>
    (await db.query<{ v: T }>(sql, values)).rows[0].v;
  const sql = await readFile(
    "docs/specs/pipeline-os/s02/worker-control/migrations/worker-control.local.sql",
    "utf8",
  );
  try {
    await owner();
    await assert.rejects(db.exec(sql), /WORKER_PILOT_TEST_MARKER_REQUIRED/);
    await db.exec("set pipeline_os.worker_control_local='in_memory_test'");
    await db.exec("begin");
    await db.exec(sql);
    await db.exec("rollback");
    assert.equal(
      await scalar("select to_regnamespace('worker_pilot') v"),
      null,
    );
    assert.equal(
      await scalar<string>("select status v from outbox where id=$1", [queued]),
      "queued",
    );
    await db.exec(sql);
    const other = await queueFixtureMail(
      f,
      accounts[0],
      users.seller,
      opportunity,
      brandA,
    );
    await service();
    const id = await scalar<string>(
      "select worker_pilot_prepare($1,$2,'client@fixture.test','gmail_oauth',clock_timestamp()+interval '10 minutes',2,1,0) v",
      [accounts[0], queued],
    );
    const lease = "a".repeat(64);
    const acquire = (key = lease) =>
      scalar<boolean>("select worker_pilot_acquire($1,$2) v", [id, key]);
    const request = (
      provider: string,
      kind: string,
      target: string,
      reserve = false,
      account = accounts[0],
    ) =>
      scalar<boolean>("select worker_pilot_request($1,$2,$3,$4) v", [
        id,
        lease,
        { provider, account, kind, target },
        reserve,
      ]);
    await t.test(
      "anon/auth cannot use control RPC or read private state; service has no direct table grants",
      async () => {
        await owner();
        assert.equal(
          await scalar<boolean>(
            "select has_table_privilege('service_role','worker_pilot.trials','select') v",
          ),
          false,
        );
        await db.exec("set role anon");
        await assert.rejects(
          scalar("select worker_pilot_acquire($1,$2) v", [id, lease]),
          /permission denied/,
        );
        await db.exec("reset role;set role authenticated");
        await assert.rejects(
          db.query("select * from worker_pilot.trials"),
          /permission denied/,
        );
        await service();
      },
    );
    await t.test(
      "only one lease acquisition; normal claim cannot take reserved message",
      async () => {
        assert.equal(await acquire(), true);
        assert.equal(await acquire(), false);
        assert.equal(await acquire("b".repeat(64)), false);
        await assert.rejects(
          db.query("select * from claim_outbox()"),
          /WORKER_PILOT_MESSAGE_HELD/,
        );
        const row = (
          await db.query<{ id: string }>(
            "select * from worker_pilot_claim($1,$2)",
            [id, lease],
          )
        ).rows[0];
        assert.equal(row.id, queued);
        assert.equal(
          (
            await db.query("select * from worker_pilot_claim($1,$2)", [
              id,
              lease,
            ])
          ).rows.length,
          0,
        );
        await owner();
        assert.equal(
          await scalar<string>("select status v from outbox where id=$1", [
            other,
          ]),
          "queued",
        );
        await service();
      },
    );
    await t.test(
      "account/recipient/resource checks happen before any reservation",
      async () => {
        assert.equal(
          await request("gmail_oauth", "send", queued, true, accounts[1]),
          false,
        );
        assert.equal(await request("composio", "send", queued, true), false);
        assert.equal(
          await request("gmail_oauth", "thread", "unrelated", true),
          false,
        );
        assert.equal(
          await request("gmail_oauth", "signature", "other@fixture.test", true),
          false,
        );
        await owner();
        assert.equal(
          await scalar<number>(
            "select jsonb_array_length(attempts) v from worker_pilot.trials where id=$1",
            [id],
          ),
          0,
        );
        await service();
      },
    );
    await t.test(
      "OAuth reserve counts once; cached token checks do not fabricate HTTP and second refresh is denied",
      async () => {
        assert.equal(await request("oauth", "oauth", accounts[0]), true);
        assert.equal(await request("oauth", "oauth", accounts[0], true), true);
        assert.equal(await request("oauth", "oauth", accounts[0]), true);
      },
    );
    await t.test(
      "one send reservation persists, thread must be that of accepted outbox, failures do not refund",
      async () => {
        assert.equal(await request("gmail_oauth", "send", queued, true), false); // B2 admission still required.
        await owner();
        const token = await scalar<string>(
          "select brand_claim_token::text v from outbox where id=$1",
          [queued],
        );
        await service();
        const admission = await scalar<string>(
          "select admit_brand_dispatch($1,$2)::text v",
          [queued, token],
        );
        assert(admission);
        assert.equal(await request("gmail_oauth", "send", queued, true), true);
        assert.equal(await request("gmail_oauth", "send", queued, true), false);
        await db.query("select mark_sent($1,'abc123','def456')", [queued]);
        assert.equal(
          await request("gmail_oauth", "thread", "wrong", true),
          false,
        );
        assert.equal(
          await request("gmail_oauth", "thread", "def456", true),
          true,
        );
        assert.equal(
          await request("gmail_oauth", "thread", "def456", true),
          false,
        );
        await owner();
        const row = (
          await db.query<{
            gmail_used: number;
            oauth_used: number;
            sends: number;
            closed: boolean;
          }>("select * from worker_pilot.trials where id=$1", [id])
        ).rows[0];
        assert.deepEqual(
          [row.gmail_used, row.oauth_used, row.sends, row.closed],
          [2, 1, 1, true],
        );
        await service();
        assert.equal(
          await scalar("select worker_pilot_snapshot($1,$2) v", [id, lease]),
          null,
        );
      },
    );
    await t.test(
      "a new process cannot reacquire or replay a completed trial",
      async () => {
        assert.equal(await acquire("c".repeat(64)), false);
        assert.equal(
          (
            await db.query("select * from worker_pilot_claim($1,$2)", [
              id,
              lease,
            ])
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "revoke before any claim pauses selected message and preserves other queue rows",
      async () => {
        const stopId = await scalar<string>(
          "select worker_pilot_prepare($1,$2,'client@fixture.test','composio',clock_timestamp()+interval '10 minutes',0,0,2) v",
          [accounts[0], other],
        );
        await db.query("select worker_pilot_revoke($1)", [stopId]);
        assert.equal(
          await scalar<boolean>("select worker_pilot_acquire($1,$2) v", [
            stopId,
            lease,
          ]),
          false,
        );
        await owner();
        assert.equal(
          await scalar<string>("select status v from outbox where id=$1", [
            other,
          ]),
          "paused",
        );
      },
    );
    await t.test(
      "expiry, wrong lease and actual OAuth exhaustion fail closed",
      async () => {
        await owner();
        await db.query(
          "update outbox set sending_at=now()-interval '2 minutes' where account_id=$1",
          [accounts[0]],
        );
        const fresh = await queueFixtureMail(
          f,
          accounts[0],
          users.seller,
          opportunity,
          brandA,
        );
        await service();
        const freshId = await scalar<string>(
          "select worker_pilot_prepare($1,$2,'client@fixture.test','gmail_oauth',clock_timestamp()+interval '10 minutes',2,1,0) v",
          [accounts[0], fresh],
        );
        assert.equal(
          await scalar("select worker_pilot_acquire($1,$2) v", [
            freshId,
            lease,
          ]),
          true,
        );
        assert.equal(
          await scalar("select worker_pilot_snapshot($1,$2) v", [
            freshId,
            "d".repeat(64),
          ]),
          null,
        );
        await db.query("select * from worker_pilot_claim($1,$2)", [
          freshId,
          lease,
        ]);
        const oauthRequest = {
          provider: "oauth",
          account: accounts[0],
          kind: "oauth",
          target: accounts[0],
        };
        assert.equal(
          await scalar("select worker_pilot_request($1,$2,$3,true) v", [
            freshId,
            lease,
            oauthRequest,
          ]),
          true,
        );
        assert.equal(
          await scalar("select worker_pilot_request($1,$2,$3,true) v", [
            freshId,
            lease,
            oauthRequest,
          ]),
          false,
        );
        await owner();
        await db.query(
          "update worker_pilot.trials set closed=false,deadline=created_at+interval '1 millisecond' where id=$1",
          [freshId],
        );
        await service();
        assert.equal(
          await scalar("select worker_pilot_snapshot($1,$2) v", [
            freshId,
            lease,
          ]),
          null,
        );
      },
    );
  } finally {
    await db.close();
  }
});
