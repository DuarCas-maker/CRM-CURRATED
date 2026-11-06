import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  c1Fixture,
  c1Candidate,
  c1Sql,
} from "./fixtures/pipeline-os-s02-composio-bindings";
import { bindingExpected } from "../src/lib/composio-bindings";
import {
  verifyComposioBinding,
  verificationContextHash,
  verificationPassed,
  requiredComposioScopes,
  incompleteVerification,
  type VerificationContext,
  type VerificationFacts,
  type VerificationTarget,
  type ComposioVerificationDependencies,
  type VerificationTiming,
} from "../src/lib/server/mail-accounts/composio-verifier";
import {
  composioBindingCheck,
  composioBindingConfirm,
} from "../src/lib/server/mail-accounts/composio-binding";

const context: VerificationContext = {
  composio_project_id: c1Candidate.composio_project_id,
  credential_version: "fictional-version-1",
  google_quota_project_id: c1Candidate.google_quota_project_id,
  auth_config_revision: "config-r1",
  provenance_reference: "fictional-reviewed-config",
  project_provenance: "server_reviewed",
  quota_provenance: "oauth_client_reviewed",
};
const target: VerificationTarget = {
  account_id: randomUUID(),
  binding_id: randomUUID(),
  ...c1Candidate,
  expected_mailbox_email: "one@c1.test",
};
function responses() {
  return {
    connection: {
      id: target.connected_account_id,
      auth_config_id: target.auth_config_id,
      user_id: target.composio_user_id,
      toolkit: "gmail",
      status: "ACTIVE",
      disabled: false,
      effective_grants: {
        connected_account_id: target.connected_account_id,
        auth_config_id: target.auth_config_id,
        user_id: target.composio_user_id,
        scopes: [...requiredComposioScopes],
        provenance_reference: "fictional-effective-grants",
        source: "effective_grants",
      },
    },
    authConfig: {
      id: target.auth_config_id,
      toolkit: "gmail",
      enabled: true,
      revision: "config-r1",
      declared_scopes: [...requiredComposioScopes],
    },
    profile: {
      connected_account_id: target.connected_account_id,
      primary_email: " ONE@C1.TEST ",
    },
  };
}
function deps(data: Record<string, unknown> = responses()) {
  const calls: string[] = [],
    signals: AbortSignal[] = [];
  const functions: ComposioVerificationDependencies = {
    connection: async (v) => {
      assert.equal(v.id, target.connected_account_id);
      calls.push("connection");
      signals.push(v.signal);
      return data.connection;
    },
    authConfig: async (v) => {
      assert.equal(v.id, target.auth_config_id);
      calls.push("authConfig");
      signals.push(v.signal);
      return data.authConfig;
    },
    profile: async (v) => {
      assert.equal(v.connectedAccountId, target.connected_account_id);
      calls.push("profile");
      signals.push(v.signal);
      return data.profile;
    },
  };
  return { functions, calls, signals };
}
const happyFacts: VerificationFacts = await verifyComposioBinding(
  target,
  context,
  deps().functions,
);
test("C2 verifier: normalized identity/provenance, limits and no retries", async (t) => {
  await t.test(
    "complete demonstrated facts only; three semantic reads and no active binding",
    async () => {
      const d = deps();
      const observed = await verifyComposioBinding(
        target,
        context,
        d.functions,
      );
      assert.deepEqual(observed, happyFacts);
      assert(verificationPassed(observed));
      assert.deepEqual(d.calls, ["connection", "authConfig", "profile"]);
      assert(d.signals.every((s) => s.aborted));
      assert.equal(Object.keys(happyFacts).length, 11);
      assert(
        !JSON.stringify(happyFacts).includes(target.expected_mailbox_email),
      );
      assert.equal(
        verificationContextHash(context),
        verificationContextHash(
          Object.fromEntries(Object.entries(context).reverse()),
        ),
      );
      assert.notEqual(
        verificationContextHash(context),
        verificationContextHash({ ...context, credential_version: "v2" }),
      );
    },
  );
  await t.test(
    "absent, malformed, extra or inconsistent trusted provenance stops before reads",
    async () => {
      for (const c of [
        null,
        {},
        { ...context, quota_provenance: "declared" },
        { ...context, project_provenance: "candidate" },
        { ...context, api_key: "fictional-rejected" },
        { ...context, composio_project_id: "another-project" },
        { ...context, google_quota_project_id: "another-quota" },
      ]) {
        const d = deps();
        assert(
          !verificationPassed(
            await verifyComposioBinding(target, c, d.functions),
          ),
        );
        assert.equal(d.calls.length, 0);
      }
      const d = deps();
      assert(
        !verificationPassed(
          await verifyComposioBinding(
            { ...target, actor_id: randomUUID() },
            context,
            d.functions,
          ),
        ),
      );
      assert.equal(d.calls.length, 0);
    },
  );
  await t.test(
    "connection/config/owner/toolkit/status/disabled must match exactly",
    async () => {
      for (const patch of [
        { id: "ca_other" },
        { auth_config_id: "ac_other" },
        { user_id: "other-owner" },
        { toolkit: "outlook" },
        { status: "INACTIVE" },
        { disabled: true },
      ]) {
        const data = responses();
        Object.assign(data.connection, patch);
        const d = deps(data);
        assert.equal(
          (await verifyComposioBinding(target, context, d.functions)).reason,
          "identity_mismatch",
        );
        assert.equal(d.calls.length, 1);
      }
      for (const patch of [
        { id: "ac_other" },
        { toolkit: "outlook" },
        { enabled: false },
        { revision: "config-r2" },
      ]) {
        const data = responses();
        Object.assign(data.authConfig, patch);
        const d = deps(data);
        assert.equal(
          (await verifyComposioBinding(target, context, d.functions)).reason,
          "identity_mismatch",
        );
        assert.equal(d.calls.length, 2);
      }
    },
  );
  await t.test(
    "declared scopes alone, partial or foreign effective grants do not prove permissions",
    async () => {
      const grants = responses().connection.effective_grants;
      for (const patch of [
        null,
        { ...grants, scopes: [] },
        { ...grants, scopes: [requiredComposioScopes[0]] },
        { ...grants, connected_account_id: "ca_other" },
        { ...grants, auth_config_id: "ac_other" },
        { ...grants, user_id: "other" },
        { ...grants, source: "declared" },
      ]) {
        const data = responses();
        const d = deps({
          ...data,
          connection: { ...data.connection, effective_grants: patch },
        });
        assert(
          !verificationPassed(
            await verifyComposioBinding(target, context, d.functions),
          ),
        );
        assert(d.calls.length <= 2);
      }
      const data = responses();
      data.authConfig.declared_scopes = [requiredComposioScopes[0]];
      const d = deps(data);
      assert.equal(
        (await verifyComposioBinding(target, context, d.functions)).reason,
        "permission_unproven",
      );
      assert.equal(d.calls.length, 2);
    },
  );
  await t.test(
    "primary identity only: no alias/plus-tag/domain/displayName or wrong connection",
    async () => {
      for (const primary_email of [
        "two@c1.test",
        "one+tag@c1.test",
        "o.ne@c1.test",
        "alias@c1.test",
      ]) {
        const data = responses();
        data.profile.primary_email = primary_email;
        const d = deps(data);
        assert.equal(
          (await verifyComposioBinding(target, context, d.functions)).reason,
          "identity_mismatch",
        );
      }
      for (const profile of [
        { connected_account_id: "ca_other", primary_email: "one@c1.test" },
        {
          connected_account_id: target.connected_account_id,
          displayName: "one@c1.test",
        },
        { ...responses().profile, body: "fictional-extra" },
      ]) {
        const d = deps({ ...responses(), profile });
        assert(
          !verificationPassed(
            await verifyComposioBinding(target, context, d.functions),
          ),
        );
      }
    },
  );
  await t.test(
    "malformed and oversized normalized data are bounded without echoing details",
    async () => {
      for (const connection of [
        null,
        [],
        {},
        "x".repeat(256 * 1024 + 1),
        { ...responses().connection, credentials: "fictional-private" },
      ]) {
        const d = deps({ ...responses(), connection });
        const f = await verifyComposioBinding(target, context, d.functions);
        assert.equal(f.reason, "verification_incomplete");
        assert.equal(d.calls.length, 1);
        assert(!JSON.stringify(f).includes("fictional-private"));
      }
    },
  );
  await t.test(
    "429, 5xx and rejected promises are sanitized, no retries or subsequent reads",
    async () => {
      for (const step of ["connection", "authConfig", "profile"] as const)
        for (const code of [429, 503]) {
          const d = deps(),
            read = {
              ...d.functions,
              [step]: async () => {
                d.calls.push(step);
                throw new Error(code + " fictional-private-error");
              },
            };
          const facts = await verifyComposioBinding(target, context, read);
          assert.equal(facts.reason, "provider_unavailable");
          assert.equal(
            d.calls.length,
            ["connection", "authConfig", "profile"].indexOf(step) + 1,
          );
          assert(!JSON.stringify(facts).includes("fictional-private"));
        }
    },
  );
  await t.test(
    "10s per dependency, total30s, timeout/abort cancel signals and never retry",
    async () => {
      const limits: number[] = [],
        d = deps();
      const timing: VerificationTiming = {
        now: () => 0,
        schedule: (ms, fn) => {
          limits.push(ms);
          const id = setImmediate(fn);
          return () => clearImmediate(id);
        },
      };
      let signal: AbortSignal | undefined;
      const f = await verifyComposioBinding(
        target,
        context,
        {
          ...d.functions,
          connection: async (v) => {
            signal = v.signal;
            d.calls.push("connection");
            return new Promise(() => {});
          },
        },
        { timing },
      );
      assert.equal(f.reason, "provider_unavailable");
      assert.deepEqual(limits, [10000]);
      assert.deepEqual(d.calls, ["connection"]);
      assert(signal?.aborted);
      const controller = new AbortController();
      controller.abort();
      const stopped = deps();
      assert(
        !verificationPassed(
          await verifyComposioBinding(target, context, stopped.functions, {
            signal: controller.signal,
          }),
        ),
      );
      assert.equal(stopped.calls.length, 0);
      let tick = 0;
      const total = deps();
      const exhausted: VerificationTiming = {
        now: () => (tick++ === 0 ? 0 : 31000),
        schedule: () => () => {},
      };
      assert(
        !verificationPassed(
          await verifyComposioBinding(target, context, total.functions, {
            timing: exhausted,
          }),
        ),
      );
      assert.equal(total.calls.length, 0);
      let elapsed = 0;
      const late = deps();
      const syncLate: VerificationTiming = {
        now: () => elapsed,
        schedule: () => () => {},
      };
      const delayed: ComposioVerificationDependencies = {
        ...late.functions,
        profile: async (v) => {
          const result = await late.functions.profile(v);
          elapsed = 10001;
          return result;
        },
      };
      assert.equal(
        (
          await verifyComposioBinding(target, context, delayed, {
            timing: syncLate,
          })
        ).reason,
        "provider_unavailable",
      );
      assert.equal(late.calls.length, 3);
    },
  );
});

type Fixture = Awaited<ReturnType<typeof c1Fixture>>;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function tools(f: Fixture) {
  const { db, asUser, users, accounts } = f;
  const service = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims','{}',false)");
    await db.exec("set role service_role");
  };
  const sync = async (c: unknown = context) => {
    await service();
    await db.query("select composio_binding_check_context($1,$2)", [
      accounts[0],
      verificationContextHash(c),
    ]);
  };
  const begin = async (
    nonce = randomBytes(32).toString("hex"),
    key = randomUUID(),
  ) => {
    await asUser(users.admin);
    const p = await f.page();
    const args = [
      accounts[0],
      p.current!.id,
      bindingExpected(p),
      verificationContextHash(context),
      sha(nonce),
      key,
    ];
    const result = (
      await db.query<{ v: { id: string; status: string } }>(
        "select composio_binding_check_begin($1,$2,$3,$4,$5,$6) v",
        args,
      )
    ).rows[0].v;
    return { id: result.id, nonce, args };
  };
  const fresh = async () => {
    await asUser(users.admin);
    await f.register();
    await sync();
    return begin();
  };
  const snapshot = async (
    c: { id: string; nonce: string },
    ctx = verificationContextHash(context),
  ) => {
    await service();
    return (
      await db.query<{ v: VerificationTarget }>(
        "select composio_binding_check_snapshot($1,$2,$3) v",
        [c.id, c.nonce, ctx],
      )
    ).rows[0].v;
  };
  const finish = async (
    c: { id: string; nonce: string },
    facts: unknown = happyFacts,
  ) => {
    await service();
    return (
      await db.query<{ v: { id: string; status: string } }>(
        "select composio_binding_check_finish($1,$2,$3,$4) v",
        [c.id, c.nonce, verificationContextHash(context), facts],
      )
    ).rows[0].v;
  };
  const confirm = async (id: string, key = randomUUID()) => {
    await asUser(users.admin);
    const p = await f.page();
    const payload = {
      ...bindingExpected(p),
      binding_id: p.current!.id,
      check_id: id,
    };
    return {
      r: await f.commandC("confirm_binding", payload, accounts[0], key),
      payload,
      key,
    };
  };
  return { service, sync, begin, fresh, snapshot, finish, confirm };
}
test("C2 sealed checks: SQL authorization, evidence, confirmation and history", async (t) => {
  const f = await c1Fixture(),
    { db, users, asUser, accounts } = f,
    s = tools(f);
  const owner = () => db.exec("reset role");
  const rows = async (sql: string, p: unknown[] = []) => {
    await owner();
    return (await db.query<Record<string, unknown>>(sql, p)).rows;
  };
  try {
    await t.test(
      "human/service RPC privileges are separate and all direct writes remain closed",
      async () => {
        const signatures = [
          "composio_binding_check_begin(uuid,uuid,jsonb,text,text,uuid)",
          "composio_binding_check_context(uuid,text)",
          "composio_binding_check_snapshot(uuid,text,text)",
          "composio_binding_check_finish(uuid,text,text,jsonb)",
        ];
        const catalog = await rows(
          "select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') human,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.oid=any($1::regprocedure[]) order by 1",
          [signatures],
        );
        assert.equal(catalog.length, 4);
        for (const p of catalog) {
          assert.equal(p.prosecdef, true);
          assert.deepEqual(p.proconfig, ['search_path=""']);
          assert.equal(p.anon, false);
          const human = String(p.signature).startsWith(
            "composio_binding_check_begin",
          );
          assert.equal(p.human, human);
          assert.equal(p.service, !human);
        }
        await asUser(users.admin);
        await assert.rejects(
          db.query("select composio_binding_check_context($1,$2)", [
            accounts[0],
            sha("bad"),
          ]),
          /permission denied/,
        );
        for (const actor of f.roles) {
          await asUser(actor);
          await assert.rejects(
            db.query(
              "select composio_binding_check_begin($1,$2,'{}',$3,$4,$5)",
              [accounts[0], randomUUID(), sha("a"), sha("b"), randomUUID()],
            ),
            /C_BINDING_FORBIDDEN/,
          );
        }
        await asUser(users.admin, "aal1");
        await assert.rejects(f.page(), /C_BINDING_FORBIDDEN/);
        for (const role of ["authenticated", "service_role", "anon"]) {
          await owner();
          await db.exec("set role " + role);
          await assert.rejects(
            db.exec("select * from mail_provider_binding_checks"),
            /permission denied/,
          );
          await assert.rejects(
            db.exec("insert into mail_provider_binding_checks default values"),
            /permission denied/,
          );
        }
      },
    );
    await t.test(
      "begin is sealed/idempotent, nonce never returned and snapshot requires service+nonce",
      async () => {
        const c = await s.fresh();
        await asUser(users.admin);
        const replay = (
          await db.query<{ v: { id: string } }>(
            "select composio_binding_check_begin($1,$2,$3,$4,$5,$6) v",
            c.args,
          )
        ).rows[0].v;
        assert.equal(replay.id, c.id);
        assert.deepEqual(Object.keys(replay).sort(), ["id", "status"]);
        await assert.rejects(
          db.query("select composio_binding_check_snapshot($1,$2,$3)", [
            c.id,
            c.nonce,
            verificationContextHash(context),
          ]),
          /permission denied/,
        );
        await assert.rejects(
          s.snapshot({ ...c, nonce: "0".repeat(64) }),
          /C_BINDING_EVIDENCE_REQUIRED/,
        );
        const t = await s.snapshot(c);
        assert.equal(t.account_id, accounts[0]);
        assert.equal(t.expected_mailbox_email, "one@c1.test");
        await assert.rejects(s.begin(), /C_BINDING_CONFLICT/);
        const stored = await rows(
          "select token_hash,actor_revision,facts from mail_provider_binding_checks where id=$1",
          [c.id],
        );
        assert.equal(stored[0].token_hash, sha(c.nonce));
        assert.equal(stored[0].facts, null);
        const receipts = await rows(
          "select result,kind from command_receipts where request_key=$1",
          [c.args[5]],
        );
        assert(!JSON.stringify(receipts).includes(c.nonce));
        await s.finish(c);
      },
    );
    await t.test(
      "successful finish leaves candidate; explicit human confirmation alone marks verified",
      async () => {
        await owner();
        const tableNames = (
          await db.query<{ name: string }>(
            "select c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'mail_provider_binding%' and c.relname not in ('command_receipts','audit_log') order by c.relname",
          )
        ).rows.map((r) => r.name);
        const business = async () => {
          await owner();
          const values = [];
          for (const name of tableNames)
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
        const businessBefore = await business();
        const c = await s.fresh();
        assert.equal((await s.finish(c)).status, "completed");
        await asUser(users.admin);
        assert.equal((await f.page()).current?.status, "candidate");
        await assert.rejects(s.finish(c), /C_BINDING_STALE/);
        const before = await rows(
          "select revision from mail_provider_binding_heads where account_id=$1",
          [accounts[0]],
        );
        const confirmed = await s.confirm(c.id);
        assert.equal(confirmed.r.status, "verified");
        assert.equal(confirmed.r.head_revision, Number(before[0].revision) + 1);
        await asUser(users.admin);
        assert.deepEqual(
          await f.commandC(
            "confirm_binding",
            confirmed.payload,
            accounts[0],
            confirmed.key,
          ),
          confirmed.r,
        );
        const page = await f.page();
        assert.equal(page.transport, "gmail_oauth");
        assert.equal(page.composio_enabled, false);
        assert.equal(page.can_confirm, false);
        assert.equal(page.current?.stale, false);
        assert.deepEqual(await business(), businessBefore);
        const facts = await rows(
          "select facts,evidence_digest,confirmed_at from mail_provider_binding_checks where id=$1",
          [c.id],
        );
        assert.deepEqual(facts[0].facts, happyFacts);
        assert.match(String(facts[0].evidence_digest), /^[a-f0-9]{64}$/);
        assert(facts[0].confirmed_at);
        await owner();
        await db.query("update profiles set active=false where id=$1", [
          users.admin,
        ]);
        await asUser(users.admin);
        await assert.rejects(
          f.commandC(
            "confirm_binding",
            confirmed.payload,
            accounts[0],
            confirmed.key,
          ),
          /C_BINDING_FORBIDDEN/,
        );
        await owner();
        await db.query("update profiles set active=true where id=$1", [
          users.admin,
        ]);
        await asUser(users.admin);
        assert.equal((await f.page()).current?.stale, true);
      },
    );
    await t.test(
      "a verified association can be replaced or revoked locally without erasing its review",
      async () => {
        await asUser(users.admin);
        const verified = (await f.page()).current!.id;
        await f.register();
        let p = await f.page();
        assert.equal(
          p.history.find((r) => r.id === verified)?.status,
          "superseded",
        );
        assert(p.history.find((r) => r.id === verified)?.reviewed_at);
        await s.sync();
        const c = await s.begin();
        await s.finish(c);
        await s.confirm(c.id);
        await asUser(users.admin);
        p = await f.page();
        await f.commandC("revoke_binding", {
          ...bindingExpected(p),
          binding_id: p.current!.id,
          reason: "operator_revoked",
        });
        assert.equal((await f.page()).current?.status, "revoked");
        assert((await f.page()).current?.reviewed_at);
      },
    );
    await t.test(
      "malformed/client evidence rejected; failed facts block atomically, never verify",
      async () => {
        const c = await s.fresh();
        for (const bad of [
          null,
          {},
          [],
          { ...happyFacts, permissions: false },
          { ...happyFacts, verified: true },
          { ...happyFacts, reason: "provider_unavailable" },
        ])
          await assert.rejects(s.finish(c, bad), /C_BINDING_INVALID_INPUT/);
        await asUser(users.admin);
        await assert.rejects(
          db.query("select composio_binding_check_finish($1,$2,$3,$4)", [
            c.id,
            c.nonce,
            verificationContextHash(context),
            happyFacts,
          ]),
          /permission denied/,
        );
        const before = (await f.page()).head_revision;
        assert.equal(
          (await s.finish(c, incompleteVerification("permission_unproven")))
            .status,
          "failed",
        );
        await asUser(users.admin);
        let p = await f.page();
        assert.equal(p.head_revision, before + 1);
        assert.equal(p.current?.status, "blocked");
        await assert.rejects(s.confirm(c.id), /C_BINDING_EVIDENCE_REQUIRED/);
        const retry = await s.begin();
        await s.finish(retry);
        await s.confirm(retry.id);
        await asUser(users.admin);
        p = await f.page();
        assert.equal(p.current?.status, "verified");
      },
    );
    await t.test(
      "wrong nonce, old context/generation or changed candidate cannot finish/confirm",
      async () => {
        let c = await s.fresh();
        await assert.rejects(
          s.finish({ ...c, nonce: "1".repeat(64) }),
          /C_BINDING_EVIDENCE_REQUIRED/,
        );
        await s.sync({ ...context, credential_version: "v2" });
        await assert.rejects(s.finish(c), /C_BINDING_STALE/);
        await s.sync();
        await assert.rejects(s.finish(c), /C_BINDING_STALE/); // ABA generation
        c = await s.fresh();
        await s.finish(c);
        await s.sync({ ...context, auth_config_revision: "changed" });
        await assert.rejects(s.confirm(c.id), /C_BINDING_EVIDENCE_REQUIRED/);
        c = await s.fresh();
        await asUser(users.admin);
        await f.register();
        const after = await f.page();
        await assert.rejects(s.finish(c), /C_BINDING_STALE/);
        await asUser(users.admin);
        assert.deepEqual(await f.page(), after);
        c = await s.fresh();
        await asUser(users.admin);
        const p = await f.page();
        await f.commandC("revoke_binding", {
          ...bindingExpected(p),
          binding_id: p.current!.id,
          reason: "connection_changed",
        });
        await assert.rejects(s.finish(c), /C_BINDING_STALE/);
      },
    );
    await t.test(
      "actor authorization revision and account ABA changes invalidate sealed evidence",
      async () => {
        let c = await s.fresh();
        await owner();
        await db.query("update profiles set active=false where id=$1", [
          users.admin,
        ]);
        await assert.rejects(s.finish(c), /C_BINDING_FORBIDDEN/);
        await owner();
        await db.query("update profiles set active=true where id=$1", [
          users.admin,
        ]);
        await assert.rejects(s.finish(c), /C_BINDING_STALE/);
        c = await s.fresh();
        await owner();
        await db.query(
          "update mail_accounts set status='disconnected' where id=$1",
          [accounts[0]],
        );
        await db.query(
          "update mail_accounts set status='connected' where id=$1",
          [accounts[0]],
        );
        await assert.rejects(s.finish(c), /C_BINDING_STALE/);
        c = await s.fresh();
        await s.finish(c);
        await owner();
        await db.query(
          "update mail_accounts set email='changed@c1.test' where id=$1",
          [accounts[0]],
        );
        await assert.rejects(s.confirm(c.id), /C_BINDING_EVIDENCE_REQUIRED/);
        await owner();
        await db.query(
          "update mail_accounts set email='one@c1.test' where id=$1",
          [accounts[0]],
        );
        await assert.rejects(s.confirm(c.id), /C_BINDING_EVIDENCE_REQUIRED/);
      },
    );
    await t.test(
      "brand revision and unrelated check cannot approve another intent",
      async () => {
        let c = await s.fresh();
        await asUser(users.admin);
        const brand = (await f.page()).account.brand_id;
        await owner();
        await db.query(
          "update operating_brands set name='Changed fixture brand' where id=$1",
          [brand],
        );
        await assert.rejects(s.finish(c), /C_BINDING_STALE/);
        c = await s.fresh();
        await s.finish(c);
        await assert.rejects(
          s.confirm(randomUUID()),
          /C_BINDING_EVIDENCE_REQUIRED/,
        );
        await asUser(users.admin);
        const p = await f.page();
        assert.equal(p.current?.status, "candidate");
      },
    );
    await t.test(
      "begin rejects foreign revisions, extra authority fields and changed idempotency payload",
      async () => {
        await asUser(users.admin);
        await f.register();
        await s.sync();
        await asUser(users.admin);
        const p = await f.page(),
          expected = bindingExpected(p);
        for (const invalid of [
          { ...expected, actor_id: users.admin },
          { ...expected, check_id: randomUUID() },
          { ...expected, binding_id: p.current!.id },
        ])
          await assert.rejects(
            db.query("select composio_binding_check_begin($1,$2,$3,$4,$5,$6)", [
              accounts[0],
              p.current!.id,
              invalid,
              verificationContextHash(context),
              sha("fictional"),
              randomUUID(),
            ]),
            /C_BINDING_INVALID_INPUT/,
          );
        await assert.rejects(
          db.query("select composio_binding_check_begin($1,$2,$3,$4,$5,$6)", [
            accounts[1],
            p.current!.id,
            expected,
            verificationContextHash(context),
            sha("fictional"),
            randomUUID(),
          ]),
          /C_BINDING_STALE/,
        );
        const c = await s.begin();
        await asUser(users.admin);
        const changed = [...c.args];
        changed[4] = sha("another-nonce");
        await assert.rejects(
          db.query(
            "select composio_binding_check_begin($1,$2,$3,$4,$5,$6)",
            changed,
          ),
          /C_BINDING_IDEMPOTENCY_CONFLICT/,
        );
        await s.finish(c);
      },
    );
    await t.test(
      "failure after evidence or approval writes rolls back check, head, binding and receipt",
      async () => {
        const c = await s.fresh();
        await asUser(users.admin);
        const initial = await f.page();
        await owner();
        await db.exec(
          "alter table audit_log add constraint c2_fixture_failure check(action<>'composio_binding.check_finish') not valid",
        );
        await assert.rejects(s.finish(c), /c2_fixture_failure/);
        await owner();
        await db.exec(
          "alter table audit_log drop constraint c2_fixture_failure",
        );
        assert.equal(
          (
            await rows(
              "select status from mail_provider_binding_checks where id=$1",
              [c.id],
            )
          )[0].status,
          "prepared",
        );
        await asUser(users.admin);
        assert.deepEqual(await f.page(), initial);
        await s.finish(c);
        await asUser(users.admin);
        const page = await f.page(),
          key = randomUUID(),
          payload = {
            ...bindingExpected(page),
            binding_id: page.current!.id,
            check_id: c.id,
          };
        await owner();
        await db.exec(
          "alter table audit_log add constraint c2_fixture_failure check(action<>'composio_binding.confirm_binding') not valid",
        );
        await asUser(users.admin);
        await assert.rejects(
          f.commandC("confirm_binding", payload, accounts[0], key),
          /c2_fixture_failure/,
        );
        await owner();
        await db.exec(
          "alter table audit_log drop constraint c2_fixture_failure",
        );
        assert.equal(
          (
            await rows(
              "select confirmed_at from mail_provider_binding_checks where id=$1",
              [c.id],
            )
          )[0].confirmed_at,
          null,
        );
        assert.equal(
          (
            await rows(
              "select count(*) n from command_receipts where request_key=$1",
              [key],
            )
          )[0].n,
          0,
        );
        await asUser(users.admin);
        assert.deepEqual(await f.page(), page);
        assert.equal(
          (await f.commandC("confirm_binding", payload, accounts[0], key))
            .status,
          "verified",
        );
      },
    );
    await t.test(
      "verified approval becomes stale after configuration rotation, without changing direct transport",
      async () => {
        const c = await s.fresh();
        await s.finish(c);
        await s.confirm(c.id);
        await asUser(users.admin);
        assert.equal((await f.page()).current?.stale, false);
        await s.sync({ ...context, credential_version: "rotated" });
        await asUser(users.admin);
        const p = await f.page();
        assert.equal(p.current?.status, "verified");
        assert.equal(p.current?.stale, true);
        assert.equal(p.transport, "gmail_oauth");
        assert.equal(p.composio_enabled, false);
        await s.sync();
        await asUser(users.admin);
        assert.equal((await f.page()).current?.stale, true);
      },
    );
  } finally {
    await db.close();
  }
});

test("C2 TTL uses DB wall clock, expires an open attempt and rejects late human confirmation", async () => {
  const f = await c1Fixture(false),
    { db } = f;
  try {
    // Time-compressed candidate, same wall-clock conditions/guards; no table trigger is disabled.
    const sql = (await readFile(c1Sql, "utf8")).replaceAll(
      "interval '10 minutes'",
      "interval '300 milliseconds'",
    );
    await db.exec("set pipeline_os.block_c_local='in_memory_test'");
    await db.exec(sql);
    const s = tools(f),
      c = await s.fresh();
    await new Promise((r) => setTimeout(r, 350));
    await assert.rejects(s.finish(c), /C_BINDING_STALE/);
    const next = await s.begin();
    await s.finish(next);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from mail_provider_binding_checks where id=$1",
          [c.id],
        )
      ).rows[0].status,
      "expired",
    );
    await new Promise((r) => setTimeout(r, 350));
    await assert.rejects(s.confirm(next.id), /C_BINDING_EVIDENCE_REQUIRED/);
    await f.asUser(f.users.admin);
    assert.equal((await f.page()).current?.status, "candidate");
    const verified = await s.begin();
    await s.finish(verified);
    await s.confirm(verified.id);
    await f.asUser(f.users.admin);
    assert.equal((await f.page()).current?.stale, false);
    await new Promise((r) => setTimeout(r, 350));
    await f.asUser(f.users.admin);
    assert.equal((await f.page()).current?.stale, true);
  } finally {
    await db.close();
  }
});

test("C2 server orchestration with fake signed/service clients and changing configuration", async (t) => {
  const f = await c1Fixture(),
    { db, users, asUser, accounts } = f;
  let actor = users.admin,
    current: unknown = context;
  const names: string[] = [];
  function client(service: boolean): SupabaseClient {
    return {
      rpc: async (name: string, p: Record<string, unknown>) => {
        names.push(name);
        try {
          if (service) {
            await db.exec("reset role");
            await db.query(
              "select set_config('request.jwt.claims','{}',false)",
            );
            await db.exec("set role service_role");
          } else await asUser(actor);
          const signatures: Record<string, string[]> = {
            composio_binding_page: ["account", "cursor", "page_size"],
            composio_binding_command: ["account", "kind", "p", "request_key"],
            composio_binding_check_context: ["account", "context_digest"],
            composio_binding_check_begin: [
              "account",
              "binding",
              "expected",
              "context_digest",
              "nonce_hash",
              "request_key",
            ],
            composio_binding_check_snapshot: [
              "check_id",
              "nonce",
              "context_digest",
            ],
            composio_binding_check_finish: [
              "check_id",
              "nonce",
              "context_digest",
              "facts",
            ],
          };
          const params = signatures[name];
          if (!params) throw new Error("unexpected RPC");
          const data = (
            await db.query<{ v: unknown }>(
              `select ${name}(${params.map((_, i) => "$" + (i + 1)).join(",")}) v`,
              params.map((k) => p[k]),
            )
          ).rows[0].v;
          return { data, error: null };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
    } as unknown as SupabaseClient;
  }
  const clients = {
    human: client(false),
    service: client(true),
    context: () => current,
  };
  const fresh = async () => {
    actor = users.admin;
    current = context;
    await asUser(actor);
    await f.register();
    const p = await f.page();
    return { binding: p.current!.id, expected: bindingExpected(p) };
  };
  try {
    await t.test(
      "check and explicit confirm compose without env/provider factories or automatic approval",
      async () => {
        const p = await fresh(),
          d = deps();
        const check = await composioBindingCheck(
          clients,
          accounts[0],
          p.binding,
          p.expected,
          d.functions,
        );
        assert.equal(check.status, "completed");
        await asUser(actor);
        const page = await f.page();
        assert.equal(page.current?.status, "candidate");
        const confirmed = await composioBindingConfirm(clients, accounts[0], {
          kind: "confirm_binding",
          payload: {
            ...bindingExpected(page),
            binding_id: p.binding,
            check_id: check.id,
          },
          idempotency_key: randomUUID(),
        });
        assert.equal(confirmed.status, "verified");
        assert.equal(confirmed.transport, "gmail_oauth");
        assert.equal(confirmed.composio_enabled, false);
        assert.equal(d.calls.length, 3);
        assert(!names.some((n) => /send|link|revoke|messages|proxy/.test(n)));
      },
    );
    await t.test(
      "unauthorized human fails before any service write or semantic read",
      async () => {
        const p = await fresh();
        actor = users.seller;
        names.length = 0;
        const d = deps();
        await assert.rejects(
          composioBindingCheck(
            clients,
            accounts[0],
            p.binding,
            p.expected,
            d.functions,
          ),
          /C_BINDING_FORBIDDEN|superadmin/,
        );
        assert.deepEqual(names, ["composio_binding_page"]);
        assert.equal(d.calls.length, 0);
      },
    );
    await t.test(
      "context rotation during read invalidates generation and does not finish or confirm",
      async () => {
        const p = await fresh(),
          d = deps();
        const changed: ComposioVerificationDependencies = {
          ...d.functions,
          profile: async (v) => {
            const out = await d.functions.profile(v);
            current = { ...context, credential_version: "new-version" };
            return out;
          },
        };
        names.length = 0;
        await assert.rejects(
          composioBindingCheck(
            clients,
            accounts[0],
            p.binding,
            p.expected,
            changed,
          ),
          /revisión|revision/,
        );
        assert(!names.includes("composio_binding_check_finish"));
        await asUser(users.admin);
        assert.equal((await f.page()).current?.status, "candidate");
      },
    );
    await t.test(
      "invalid config at confirmation invalidates prior evidence; generic SQL failure never falls back",
      async () => {
        const p = await fresh();
        const c = await composioBindingCheck(
          clients,
          accounts[0],
          p.binding,
          p.expected,
          deps().functions,
        );
        await asUser(actor);
        const page = await f.page();
        current = {};
        await assert.rejects(
          composioBindingConfirm(clients, accounts[0], {
            kind: "confirm_binding",
            payload: {
              ...bindingExpected(page),
              binding_id: p.binding,
              check_id: c.id,
            },
            idempotency_key: randomUUID(),
          }),
          /disponible|unavailable/,
        );
        await asUser(actor);
        await assert.rejects(
          f.commandC("confirm_binding", {
            ...bindingExpected(page),
            binding_id: p.binding,
            check_id: c.id,
          }),
          /C_BINDING_EVIDENCE_REQUIRED/,
        );
        current = context;
        const bad = {
          ...clients,
          service: {
            rpc: async () => ({
              data: null,
              error: { message: "fictional-secret-error" },
            }),
          } as unknown as SupabaseClient,
        };
        await assert.rejects(
          composioBindingCheck(
            bad,
            accounts[0],
            p.binding,
            p.expected,
            deps().functions,
          ),
          (e) =>
            e instanceof Error &&
            !e.message.includes("fictional-secret") &&
            /unavailable|disponible/.test(e.message),
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("C2 SQL remains marker-only and rolls back without altering pre-C functions or business tables", async () => {
  const f = await c1Fixture(false),
    { db } = f;
  try {
    const catalog = async () =>
      (
        await db.query<{
          signature: string;
          definition: string;
          acl: string | null;
        }>(
          "select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','s01_i02','brand_b1','brand_b2') order by signature",
        )
      ).rows;
    const before = await catalog(),
      sql = await readFile(c1Sql, "utf8");
    await assert.rejects(db.exec(sql), /explicit in-memory marker/);
    await db.exec("rollback");
    await db.exec("begin;set local pipeline_os.block_c_local='in_memory_test'");
    await db.exec(
      sql.replace(/^([\s\S]*?)begin;/, (_m, c) => c).replace(/commit;\s*$/, ""),
    );
    const after = await catalog();
    for (const row of before)
      assert.deepEqual(
        after.find((r) => r.signature === row.signature),
        row,
      );
    await f.asUser(f.users.admin);
    await f.register();
    await db.exec("rollback");
    assert.deepEqual(await catalog(), before);
    assert.equal(
      (
        await db.query<{ v: string | null }>(
          "select to_regnamespace('composio_c1')::text v",
        )
      ).rows[0].v,
      null,
    );
    for (const path of [
      "src/lib/server/mail-accounts/composio-verifier.ts",
      "src/lib/server/mail-accounts/composio-binding.ts",
    ]) {
      const source = await readFile(path, "utf8");
      assert(
        !/\bfetch\s*\(|process\.env|serviceClient\s*\(|ResolvedComposioBinding|from ["'].*s00/.test(
          source,
        ),
      );
    }
  } finally {
    await db.close();
  }
});
