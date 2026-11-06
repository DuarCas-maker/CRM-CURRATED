import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  c1Fixture,
  c1Candidate,
  c1Sql,
} from "./fixtures/pipeline-os-s02-composio-bindings";
import {
  bindingExpected,
  bindingPageSchema,
} from "../src/lib/composio-bindings";

test("C1 SQL: candidates, permissions, CAS, privacy and no direct-mail effects", async (t) => {
  const f = await c1Fixture(),
    { db, users, asUser, accounts, page, commandC, register } = f;
  const owner = () => db.exec("reset role");
  const row = async (sql: string, p: unknown[] = []) =>
    (await db.query<Record<string, unknown>>(sql, p)).rows[0];
  try {
    await t.test(
      "empty page is account-scoped, direct, unverified and side-effect free",
      async () => {
        await asUser(users.admin);
        const data = await page();
        assert.ok(bindingPageSchema.safeParse(data).success);
        assert.equal(data.current, null);
        assert.deepEqual(data.history, []);
        assert.equal(data.head_revision, 0);
        assert.equal(data.account.ready, true);
        assert.equal(data.transport, "gmail_oauth");
        assert.equal(data.can_confirm, false);
        assert.equal(data.composio_enabled, false);
        await owner();
        assert.equal(
          (await row("select count(*) n from mail_provider_binding_heads")).n,
          0,
        );
      },
    );
    await t.test(
      "four operational roles, AAL1, inactive, anon and service cannot administer",
      async () => {
        for (const actor of f.roles) {
          await asUser(actor);
          await assert.rejects(page(), /C_BINDING_FORBIDDEN/);
          await assert.rejects(
            commandC("register_candidate", {}),
            /C_BINDING_FORBIDDEN/,
          );
        }
        await asUser(users.admin, "aal1");
        await assert.rejects(page(), /C_BINDING_FORBIDDEN/);
        await owner();
        await db.query("update profiles set active=false where id=$1", [
          users.admin,
        ]);
        await asUser(users.admin);
        await assert.rejects(page(), /C_BINDING_FORBIDDEN/);
        await owner();
        await db.query("update profiles set active=true where id=$1", [
          users.admin,
        ]);
        for (const role of ["anon", "service_role"]) {
          await owner();
          await db.exec("set role " + role);
          await assert.rejects(page(), /permission denied/);
          await assert.rejects(
            commandC("register_candidate", {}),
            /permission denied/,
          );
        }
      },
    );
    await t.test(
      "all three relations have RLS and no direct DML/read grants, including service",
      async () => {
        for (const role of ["anon", "authenticated", "service_role"]) {
          await owner();
          await db.exec("set role " + role);
          for (const table of [
            "mail_provider_bindings",
            "mail_provider_binding_heads",
            "mail_provider_binding_checks",
          ]) {
            await assert.rejects(
              db.exec("select * from " + table),
              /permission denied/,
            );
            await assert.rejects(
              db.exec("delete from " + table),
              /permission denied/,
            );
            await assert.rejects(
              db.exec("insert into " + table + " default values"),
              /permission denied/,
            );
          }
          await assert.rejects(
            db.query("select composio_c1.context($1)", [accounts[0]]),
            /permission denied/,
          );
        }
        await owner();
        assert.equal(
          (
            await row(
              "select count(*) n from pg_class where relname in ('mail_provider_bindings','mail_provider_binding_heads','mail_provider_binding_checks') and relrowsecurity",
            )
          ).n,
          3,
        );
      },
    );
    await t.test(
      "SQL validates the same strict shape and derives mailbox/actor; unreviewed account cannot register",
      async () => {
        await asUser(users.admin);
        const p = { ...bindingExpected(await page()), ...c1Candidate };
        for (const input of [null, true, [], 3])
          await assert.rejects(
            db.query("select composio_binding_command($1,$2,$3,$4)", [
              accounts[0],
              "register_candidate",
              input,
              randomUUID(),
            ]),
            /C_BINDING_INVALID_INPUT/,
          );
        for (const input of [
          { ...p, verified: true },
          { ...p, expected_mailbox_email: "wrong@c1.test" },
          { ...p, actor_id: users.seller },
          { ...p, auth_config_id: p.connected_account_id },
          { ...p, expected_head_revision: "0" },
          { ...p, expected_head_revision: null },
          { ...p, composio_user_id: "" },
          { ...p, composio_project_id: "ca_swapped" },
        ])
          await assert.rejects(
            commandC("register_candidate", input),
            /C_BINDING_INVALID_INPUT/,
          );
        await assert.rejects(
          commandC("anything", p),
          /C_BINDING_INVALID_INPUT/,
        );
        assert.equal((await page(accounts[2])).account.ready, false);
        await assert.rejects(
          register({}, accounts[2]),
          /C_BINDING_ACCOUNT_NOT_READY/,
        );
      },
    );
    await t.test(
      "a receipt from a previous CRM command cannot be reused for C",
      async () => {
        await asUser(users.admin);
        const key = randomUUID();
        await f.command(
          "brand_create",
          {
            code: "RECEIPT_" + randomUUID().slice(0, 8),
            name: "Fixture",
            active: false,
          },
          key,
        );
        await assert.rejects(
          register({}, accounts[0], key),
          /C_BINDING_IDEMPOTENCY_CONFLICT/,
        );
        assert.equal((await page()).head_revision, 0);
      },
    );
    let first = "";
    await t.test(
      "registration and replay are atomic, canonical and expose only masked references",
      async () => {
        await asUser(users.admin);
        const p = { ...bindingExpected(await page()), ...c1Candidate },
          key = randomUUID();
        const created = await commandC(
          "register_candidate",
          p,
          accounts[0],
          key,
        );
        first = created.id;
        assert.deepEqual(
          await commandC(
            "register_candidate",
            { ...p, composio_user_id: " " + p.composio_user_id + " " },
            accounts[0],
            key,
          ),
          created,
        );
        await assert.rejects(
          commandC(
            "register_candidate",
            { ...p, connected_account_id: "ca_different" },
            accounts[0],
            key,
          ),
          /C_BINDING_IDEMPOTENCY_CONFLICT/,
        );
        await assert.rejects(
          commandC("register_candidate", p, accounts[1], key),
          /C_BINDING_IDEMPOTENCY_CONFLICT/,
        );
        const current = await page();
        assert.equal(current.current?.id, first);
        assert.equal(current.head_revision, 1);
        assert.equal(current.current?.status, "candidate");
        assert.equal(current.current?.stale, false);
        assert.ok(bindingPageSchema.safeParse(current).success);
        for (const value of Object.values(c1Candidate))
          assert(!JSON.stringify(current).includes(value));
        await owner();
        const stored = await row(
          "select expected_mailbox_email,created_by,reviewed_at from mail_provider_bindings where id=$1",
          [first],
        );
        assert.equal(stored.expected_mailbox_email, "one@c1.test");
        assert.equal(stored.created_by, users.admin);
        assert.equal(stored.reviewed_at, null);
        assert.equal(
          (
            await row(
              "select count(*) n from command_receipts where user_id=$1 and request_key=$2",
              [users.admin, key],
            )
          ).n,
          1,
        );
        assert.equal(
          (
            await row(
              "select count(*) n from audit_log where entity_id=$1 and action='composio_binding.register_candidate'",
              [first],
            )
          ).n,
          1,
        );
        await db.query("update profiles set active=false where id=$1", [
          users.admin,
        ]);
        await asUser(users.admin);
        await assert.rejects(
          commandC("register_candidate", p, accounts[0], key),
          /C_BINDING_FORBIDDEN/,
        );
        await owner();
        await db.query("update profiles set active=true where id=$1", [
          users.admin,
        ]);
      },
    );
    await t.test(
      "connection conflicts revert an absent or existing target head and preserve its previous candidate",
      async () => {
        await asUser(users.admin);
        await assert.rejects(register({}, accounts[1]), /C_BINDING_CONFLICT/);
        assert.equal((await page(accounts[1])).head_revision, 0);
        const other = await register(
          { connected_account_id: "ca_different_private" },
          accounts[1],
        );
        const before = await page(accounts[1]);
        await assert.rejects(register({}, accounts[1]), /C_BINDING_CONFLICT/);
        assert.deepEqual(await page(accounts[1]), before);
        assert.equal(before.current?.id, other.id);
      },
    );
    await t.test(
      "stale head, brand, account or identity context does not create another intent",
      async () => {
        await asUser(users.admin);
        const p = { ...bindingExpected(await page()), ...c1Candidate };
        for (const extra of [
          { expected_head_revision: 0 },
          { expected_brand_revision: 9 },
          { expected_account_revision: 9 },
          { expected_context_hash: "a".repeat(64) },
        ])
          await assert.rejects(
            commandC("register_candidate", { ...p, ...extra }),
            /C_BINDING_STALE/,
          );
        await owner();
        await db.query(
          "update mail_accounts set status='disconnected' where id=$1",
          [accounts[0]],
        );
        await asUser(users.admin);
        await assert.rejects(
          commandC("register_candidate", p),
          /C_BINDING_STALE/,
        );
        const stale = await page();
        assert.equal(stale.current?.stale, true);
        assert.equal(stale.account.ready, false);
        await owner();
        await db.query(
          "update mail_accounts set status='connected' where id=$1",
          [accounts[0]],
        );
      },
    );
    await t.test(
      "logical CAS has one winner; tuple immutable, predecessor retained and confirmation unavailable",
      async () => {
        await asUser(users.admin);
        const p = {
          ...bindingExpected(await page()),
          ...c1Candidate,
          connected_account_id: "ca_replacement_private",
        };
        const replacement = await commandC("register_candidate", p);
        await assert.rejects(
          commandC("register_candidate", p),
          /C_BINDING_STALE/,
        );
        const after = await page();
        assert.equal(after.current?.id, replacement.id);
        assert.equal(
          after.history.find((x) => x.id === first)?.status,
          "superseded",
        );
        await assert.rejects(
          commandC("confirm_binding", {
            ...bindingExpected(after),
            binding_id: replacement.id,
            check_id: randomUUID(),
          }),
          /C_BINDING_EVIDENCE_REQUIRED/,
        );
        assert.deepEqual(await page(), after);
        await owner();
        await db.query("select set_config('pipeline_os.c1_command',$1,true)", [
          users.admin,
        ]);
        await assert.rejects(
          db.query(
            "update mail_provider_bindings set connected_account_id='ca_fabricated' where id=$1",
            [replacement.id],
          ),
          /C_BINDING_FORBIDDEN|C_BINDING_IMMUTABLE/,
        );
        await assert.rejects(
          db.query("delete from mail_provider_bindings where id=$1", [
            replacement.id,
          ]),
          /C_BINDING_IMMUTABLE/,
        );
      },
    );
    await t.test(
      "revocation and replacement preserve direct credentials, B2 snapshots and all business rows",
      async () => {
        await owner();
        const names = (
          await db.query<{ name: string }>(
            "select c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'mail_provider_binding%' and c.relname not in ('command_receipts','audit_log') order by c.relname",
          )
        ).rows.map((r) => r.name);
        const snapshot = async () => {
          const values = [];
          for (const name of names)
            values.push(
              (
                await db.query(
                  "select coalesce(jsonb_agg(x order by to_jsonb(x)::text),'[]') rows from public.\"" +
                    name.replaceAll('"', '""') +
                    '" x',
                )
              ).rows,
            );
          return values;
        };
        const before = await snapshot();
        await asUser(users.admin);
        let state = await page();
        const previous = state.current!.id;
        const revoked = await commandC("revoke_binding", {
          ...bindingExpected(state),
          binding_id: previous,
          reason: "operator_revoked",
        });
        assert.equal(revoked.status, "revoked");
        state = await page();
        assert.equal(state.head_revision, revoked.head_revision);
        const next = await register({
          connected_account_id: "ca_final_private",
        });
        state = await page();
        assert.equal(state.current?.id, next.id);
        assert.equal(
          state.history.find((x) => x.id === previous)?.status,
          "revoked",
        );
        assert(state.head_revision > revoked.head_revision);
        await owner();
        assert.deepEqual(await snapshot(), before);
        assert.equal(
          (await row("select count(*) n from mail_provider_binding_checks")).n,
          0,
        );
      },
    );
    await t.test(
      "revocation remains available when the direct account is no longer ready",
      async () => {
        await owner();
        await db.query(
          "update mail_accounts set status='disconnected' where id=$1",
          [accounts[0]],
        );
        await asUser(users.admin);
        const p = await page();
        assert.equal(p.account.ready, false);
        await commandC("revoke_binding", {
          ...bindingExpected(p),
          binding_id: p.current!.id,
          reason: "connection_changed",
        });
        assert.equal((await page()).current?.status, "revoked");
      },
    );
  } finally {
    await db.close();
  }
});

test("C1 history is bounded, cursor-scoped and never exposes complete short or long IDs", async () => {
  const f = await c1Fixture();
  try {
    await f.asUser(f.users.admin);
    for (let i = 0; i < 102; i++)
      await f.register({
        connected_account_id: "ca_history_" + i,
        composio_user_id: i % 2 ? "tiny" : "owner-private-long",
      });
    const first = await f.page(f.accounts[0], null, 100);
    assert.equal(first.history.length, 100);
    assert.ok(first.cursor);
    const second = await f.page(f.accounts[0], first.cursor, 100);
    assert.equal(second.history.length, 2);
    assert.equal(second.cursor, null);
    assert.equal(
      new Set([...first.history, ...second.history].map((r) => r.id)).size,
      102,
    );
    assert(!JSON.stringify(first).includes("tiny"));
    assert(!JSON.stringify(first).includes("owner-private-long"));
    assert.equal((await f.page(f.accounts[1])).history.length, 0);
    await assert.rejects(
      f.page(f.accounts[1], first.cursor),
      /C_BINDING_STALE/,
    );
    await assert.rejects(
      f.page(f.accounts[0], "invalid"),
      /C_BINDING_INVALID_INPUT/,
    );
    await assert.rejects(
      f.page(f.accounts[0], null, 101),
      /C_BINDING_INVALID_INPUT/,
    );
  } finally {
    await f.db.close();
  }
});

test("C1 candidate requires a marker, preserves existing functions/ACL and rolls back completely", async () => {
  const f = await c1Fixture(false),
    { db } = f;
  try {
    const catalog = async () =>
      (
        await db.query<{
          signature: string;
          definition: string;
          acl: string | null;
          prosecdef: boolean;
        }>(
          "select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) definition,p.proacl::text acl,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','s01_i02','brand_b1','brand_b2') order by signature",
        )
      ).rows;
    const before = await catalog(),
      sql = await readFile(c1Sql, "utf8");
    await assert.rejects(db.exec(sql), /explicit in-memory marker/);
    await db.exec("rollback");
    await db.exec("begin;set local pipeline_os.block_c_local='in_memory_test'");
    await db.exec(
      sql
        .replace(/^([\s\S]*?)begin;/, (_m, comment) => comment)
        .replace(/commit;\s*$/, ""),
    );
    const after = await catalog();
    for (const prior of before)
      assert.deepEqual(
        after.find((r) => r.signature === prior.signature),
        prior,
      );
    await f.asUser(f.users.admin);
    await f.register();
    await db.exec("rollback");
    assert.equal(
      (
        await db.query<{ v: string | null }>(
          "select to_regnamespace('composio_c1')::text v",
        )
      ).rows[0].v,
      null,
    );
    assert.deepEqual(await catalog(), before);
  } finally {
    await db.close();
  }
});
