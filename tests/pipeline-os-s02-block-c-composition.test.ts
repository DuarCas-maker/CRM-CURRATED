import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as supabase from "../src/lib/server/supabase";
import * as crypto from "../src/lib/server/crypto";
import { createMailTransport } from "../src/lib/server/mail-transport/factory";
import { MailTransportError } from "../src/lib/server/mail-transport/errors";
import { fixtureBinding } from "./fixtures/pipeline-os-s02-transport";
import {
  c1Fixture,
  c1Sql,
  c1Candidate,
} from "./fixtures/pipeline-os-s02-composio-bindings";
import { queueFixtureMail } from "./fixtures/pipeline-os-s02-brand-delivery";
import {
  bindingExpected,
  bindingPageSchema,
} from "../src/lib/composio-bindings";
import {
  composioBindingCheck,
  composioBindingConfirm,
} from "../src/lib/server/mail-accounts/composio-binding";
import {
  requiredComposioScopes,
  type VerificationContext,
  type ComposioVerificationDependencies,
} from "../src/lib/server/mail-accounts/composio-verifier";

type Fixture = Awaited<ReturnType<typeof c1Fixture>>;
type Row = Record<string, unknown>;
const context: VerificationContext = {
  composio_project_id: c1Candidate.composio_project_id,
  credential_version: "c3-fictional-reviewed-version",
  google_quota_project_id: c1Candidate.google_quota_project_id,
  auth_config_revision: "c3-reviewed-config",
  provenance_reference: "c3-fictional-only",
  project_provenance: "server_reviewed",
  quota_provenance: "oauth_client_reviewed",
};
function scenario(f: Fixture) {
  const { db, users, asUser, accounts } = f;
  let actor = users.admin;
  const owner = () => db.exec("reset role");
  const service = async () => {
    await owner();
    await db.query("select set_config('request.jwt.claims','{}',false)");
    await db.exec("set role service_role");
  };
  const value = async <T>(name: string, args: unknown[] = []) =>
    (
      await db.query<{ v: T }>(
        `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) v`,
        args,
      )
    ).rows[0].v;
  const calls: string[] = [];
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
    composio_binding_check_snapshot: ["check_id", "nonce", "context_digest"],
    composio_binding_check_finish: [
      "check_id",
      "nonce",
      "context_digest",
      "facts",
    ],
    reserve_gmail_api: ["account", "project", "units"],
  };
  function client(privileged: boolean): SupabaseClient {
    return {
      rpc: async (name: string, p: Record<string, unknown>) => {
        assert(Object.hasOwn(signatures, name), "Unexpected fixture RPC");
        calls.push(name);
        try {
          if (privileged) await service();
          else await asUser(actor);
          return {
            data: await value(
              name,
              signatures[name].map((k) => p[k]),
            ),
            error: null,
          };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
    } as unknown as SupabaseClient;
  }
  const clients = {
    human: client(false),
    service: client(true),
    context: () => context,
  };
  const semantic: string[] = [];
  const dependencies = (
    email = "one@c1.test",
  ): ComposioVerificationDependencies => ({
    connection: async ({ id }) => {
      semantic.push("connection");
      return {
        id,
        auth_config_id: c1Candidate.auth_config_id,
        user_id: c1Candidate.composio_user_id,
        toolkit: "gmail",
        status: "ACTIVE",
        disabled: false,
        effective_grants: {
          connected_account_id: id,
          auth_config_id: c1Candidate.auth_config_id,
          user_id: c1Candidate.composio_user_id,
          scopes: [...requiredComposioScopes],
          source: "effective_grants",
          provenance_reference: "c3-fake-grants",
        },
      };
    },
    authConfig: async ({ id }) => {
      semantic.push("auth_config");
      return {
        id,
        toolkit: "gmail",
        enabled: true,
        revision: context.auth_config_revision,
        declared_scopes: [...requiredComposioScopes],
      };
    },
    profile: async ({ connectedAccountId }) => {
      semantic.push("profile");
      return { connected_account_id: connectedAccountId, primary_email: email };
    },
  });
  const check = async (email?: string) => {
    actor = users.admin;
    await asUser(actor);
    const p = await f.page();
    return composioBindingCheck(
      clients,
      accounts[0],
      p.current!.id,
      bindingExpected(p),
      dependencies(email),
    );
  };
  const confirm = async (id: string) => {
    actor = users.admin;
    await asUser(actor);
    const p = await f.page();
    return composioBindingConfirm(clients, accounts[0], {
      kind: "confirm_binding",
      payload: {
        ...bindingExpected(p),
        binding_id: p.current!.id,
        check_id: id,
      },
      idempotency_key: randomUUID(),
    });
  };
  const register = async (extra: object = {}) => {
    actor = users.admin;
    await asUser(actor);
    return f.register(extra);
  };
  const verify = async () => {
    const c = await check();
    assert.equal(c.status, "completed");
    const r = await confirm(c.id);
    assert.equal(r.status, "verified");
    return r;
  };
  const revoke = async () => {
    await asUser(users.admin);
    const p = await f.page();
    return f.commandC("revoke_binding", {
      ...bindingExpected(p),
      binding_id: p.current!.id,
      reason: "operator_revoked",
    });
  };
  const claim = async () => {
    await service();
    return (await db.query<Row>("select * from claim_outbox()")).rows[0];
  };
  const admit = async (m: Row) => {
    await service();
    return value<string | null>("admit_brand_dispatch", [
      m.id,
      m.brand_claim_token,
    ]);
  };
  const rows = async (sql: string, args: unknown[] = []) => {
    await owner();
    return (await db.query<Row>(sql, args)).rows;
  };
  const business = async (includeReceipts = false) => {
    const names = (
      await rows(
        "select c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not like 'mail_provider_binding%' order by c.relname",
      )
    ).map((r) => String(r.name));
    const data: Record<string, unknown> = {};
    for (const name of names)
      if (includeReceipts || !["command_receipts", "audit_log"].includes(name))
        data[name] = (
          await rows(
            "select coalesce(jsonb_agg(x order by to_jsonb(x)::text),'[]') data from public.\"" +
              name.replaceAll('"', '""') +
              '" x',
          )
        )[0].data;
    return data;
  };
  const directPreparation = async () => {
    await asUser(users.seller);
    return value<Row>("brand_prepare_context", [
      accounts[0],
      f.brandA,
      "mail",
      f.opportunity,
    ]);
  };
  return {
    owner,
    service,
    value,
    clients,
    rows,
    business,
    register,
    check,
    confirm,
    verify,
    revoke,
    claim,
    admit,
    directPreparation,
    calls,
    semantic,
  };
}

if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("C3 composition in isolated module mocks", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    // Propagate an optional offline preload used by local QA, without requiring private files in normal CI.
    const imports = process.execArgv.flatMap((arg, i) =>
      arg === "--import" && process.execArgv[i + 1]?.endsWith("offline.mjs")
        ? [arg, process.execArgv[i + 1]]
        : [],
    );
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        ...imports,
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s02-block-c-composition.test.ts",
      ],
      { env, encoding: "utf8", timeout: 90000 },
    );
    assert.match(output, /# fail 0/);
    assert.match(output, /# skipped 0/);
  });
else {
  test("C3: C lifecycle preserves the original direct intent and real Gmail facade", async (t) => {
    const f = await c1Fixture(),
      s = scenario(f),
      events: string[] = [];
    let wire = 0;
    const previous = {
      organizations: process.env.GOOGLE_OAUTH_ORGANIZATIONS,
      origin: process.env.APP_ORIGIN,
    };
    process.env.GOOGLE_OAUTH_ORGANIZATIONS = JSON.stringify([
      {
        id: "fixture",
        domain: "c1.test",
        clientId: "c3-fake.apps.googleusercontent.com",
        clientSecret: "c3-fictional-secret",
        projectId: "c3-direct-quota",
      },
    ]);
    process.env.APP_ORIGIN = "https://c3-app.example.test";
    const serviceDb = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, "reserve_gmail_api");
        events.push("reserve");
        assert.equal(args.project, "c3-direct-quota");
        assert.notEqual(args.project, context.google_quota_project_id);
        return s.clients.service.rpc(name, args);
      },
      from: (name: string) => {
        assert(["mail_accounts", "mail_credentials"].includes(name));
        return {
          select: () => ({
            eq: (key: string, id: string) => {
              assert.equal(key, name === "mail_accounts" ? "id" : "account_id");
              assert.equal(id, f.accounts[0]);
              return {
                single: async () => {
                  await s.service();
                  return {
                    data: (
                      await f.db.query<Row>(
                        "select * from " +
                          name +
                          " where " +
                          (name === "mail_accounts" ? "id" : "account_id") +
                          "=$1",
                        [id],
                      )
                    ).rows[0],
                    error: null,
                  };
                },
              };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;
    const supabaseMock = mock.module("../src/lib/server/supabase.ts", {
      namedExports: { ...supabase, serviceClient: () => serviceDb },
    });
    const cryptoMock = mock.module("../src/lib/server/crypto.ts", {
      namedExports: {
        ...crypto,
        decrypt: (cipher: string) => {
          assert.equal(cipher, "fictional-encrypted-token");
          return "c3-fictional-refresh";
        },
      },
    });
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => {
      events.push("oauth");
      return { token: "c3-direct-access" };
    });
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        assert.equal(
          String(input),
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        );
        assert.equal(init?.method ?? "GET", "GET");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer c3-direct-access",
        );
        events.push("wire");
        wire++;
        return Response.json({
          emailAddress: "one@c1.test",
          historyId: "c3-fake-history",
        });
      },
    );
    try {
      const { gmail } = await import("../src/lib/server/google");
      const original = await s.business(),
        queued = (
          await s.rows("select * from outbox where id=$1", [f.queued])
        )[0];
      const assertPreserved = async () => {
        assert.deepEqual(await s.business(), original);
        const p = await s.directPreparation();
        assert.equal(p.brand_revision, f.brandA.brand_revision);
        assert.equal(p.account_revision, f.brandA.account_revision);
        await f.asUser(f.users.admin);
        const page = await f.page();
        assert(bindingPageSchema.safeParse(page).success);
        assert.equal(page.transport, "gmail_oauth");
        assert.equal(page.composio_enabled, false);
      };
      await t.test(
        "candidate, wrong identity and blocked state preserve B2 preparation/credentials/queue",
        async () => {
          await s.register();
          await assertPreserved();
          const bad = await s.check("other@c3.test");
          assert.equal(bad.status, "failed");
          await assert.rejects(s.confirm(bad.id), /evidencia|evidence/);
          await assertPreserved();
          await f.asUser(f.users.admin);
          assert.equal((await f.page()).current?.status, "blocked");
        },
      );
      await t.test(
        "recover evidence, confirm, replace and revoke without changing business rows",
        async () => {
          const verified = await s.verify();
          await assertPreserved();
          await s.register({ connected_account_id: "ca_c3_replacement" });
          await assertPreserved();
          await f.asUser(f.users.admin);
          assert.equal(
            (await f.page()).history.find((r) => r.id === verified.id)?.status,
            "superseded",
          );
          await s.verify();
          await assertPreserved();
          await s.revoke();
          await assertPreserved();
          assert.deepEqual(
            (await s.rows("select * from outbox where id=$1", [f.queued]))[0],
            queued,
          );
        },
      );
      await t.test(
        "none of the persisted C states constructs an active Composio transport",
        async () => {
          let proxy = 0;
          for (const status of [
            "candidate",
            "blocked",
            "verified",
            "revoked",
            "superseded",
          ]) {
            assert.throws(
              () =>
                createMailTransport({
                  provider: "composio",
                  apiKey: "c3-fake-key",
                  binding: { ...fixtureBinding, status },
                  fetchImpl: async () => {
                    proxy++;
                    throw Error("No proxy expected");
                  },
                } as never),
              (e) =>
                e instanceof MailTransportError &&
                e.code === "INVALID_COMPOSIO_BINDING",
            );
          }
          assert.equal(proxy, 0);
          assert.equal(wire, 0);
        },
      );
      await t.test(
        "the already-prepared direct intent still admits once; actual facade retains direct quota and final hook",
        async () => {
          const m = await s.claim();
          assert.equal(m.id, f.queued);
          assert.equal(m.message_id_header, queued.message_id_header);
          assert.deepEqual(m.brand_snapshot, queued.brand_snapshot);
          let permit: string | null = null;
          const profile = await gmail<{ emailAddress: string }>(
            f.accounts[0],
            "profile",
            {},
            async () => {
              events.push("guard");
              permit = await s.admit(m);
              assert(permit);
            },
          );
          assert.equal(profile.emailAddress, "one@c1.test");
          assert.deepEqual(events, ["oauth", "reserve", "guard", "wire"]);
          assert.equal(wire, 1);
          assert.equal(await s.admit(m), null);
          assert.equal(
            (
              await s.rows(
                "select count(*) n from mail_brand_dispatch_admissions where outbox_id=$1",
                [m.id],
              )
            )[0].n,
            1,
          );
          // This was a synthetic profile GET, never messages/send and never a sent record.
          assert.equal(
            (await s.rows("select status from outbox where id=$1", [m.id]))[0]
              .status,
            "sending",
          );
        },
      );
    } finally {
      supabaseMock.restore();
      cryptoMock.restore();
      if (previous.organizations === undefined)
        delete process.env.GOOGLE_OAUTH_ORGANIZATIONS;
      else process.env.GOOGLE_OAUTH_ORGANIZATIONS = previous.organizations;
      if (previous.origin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = previous.origin;
      await f.db.close();
    }
  });

  test("C3: verified C never grants S01 capabilities or bypasses the B2 cut", async (t) => {
    const f = await c1Fixture(),
      s = scenario(f),
      { db, users, asUser, accounts } = f;
    const matrix = async () => {
      const entries = [];
      for (const actor of [users.admin, ...f.roles, users.outsider]) {
        await asUser(actor);
        entries.push({
          actor,
          send: await s.value<boolean>("can_send", [accounts[0]]),
          case: await s.value<boolean>("can_mail_case", [f.opportunity]),
          capabilities: (
            await db.query<{ v: unknown }>(
              "select brand_sender_capabilities() v",
            )
          ).rows.map((r) => r.v),
        });
      }
      return entries;
    };
    try {
      const before = await matrix();
      await s.register();
      await s.verify();
      await t.test(
        "roles, account/case access and sender capabilities are identical before/after C",
        async () => {
          assert.deepEqual(await matrix(), before);
          for (const actor of f.roles) {
            await asUser(actor);
            await assert.rejects(f.page(), /C_BINDING_FORBIDDEN/);
          }
          await asUser(users.admin, "aal1");
          await assert.rejects(f.page(), /C_BINDING_FORBIDDEN/);
          await asUser(users.outsider);
          assert.equal(await s.value("can_send", [accounts[0]]), false);
          assert.equal(await s.value("can_mail_case", [f.opportunity]), false);
        },
      );
      await t.test(
        "revoking the seller membership pauses the old direct intent despite verified C",
        async () => {
          await asUser(users.admin);
          await f.command("brand_membership_set", {
            brand_id: f.brandA.brand_id,
            user_id: users.seller,
            active: false,
            expected_revision: 1,
          });
          assert.equal(await s.claim(), undefined);
          assert.equal(
            (
              await s.rows("select status from outbox where id=$1", [f.queued])
            )[0].status,
            "paused",
          );
          assert.equal(
            (
              await s.rows(
                "select count(*) n from mail_brand_dispatch_admissions where outbox_id=$1",
                [f.queued],
              )
            )[0].n,
            0,
          );
          await asUser(users.admin);
          assert.equal((await f.page()).current?.status, "verified");
        },
      );
      await t.test(
        "restoring a membership or altering C does not rejuvenate the old intent; new preparation can admit",
        async () => {
          await asUser(users.admin);
          await f.command("brand_membership_set", {
            brand_id: f.brandA.brand_id,
            user_id: users.seller,
            active: true,
            expected_revision: 2,
          });
          await s.revoke();
          assert.equal(await s.claim(), undefined);
          const id = await queueFixtureMail(
            f,
            accounts[0],
            users.seller,
            f.opportunity,
            f.brandA,
          );
          const m = await s.claim();
          assert.equal(m.id, id);
          assert(await s.admit(m));
          assert.equal(await s.admit(m), null);
          assert.equal(
            (
              await s.rows("select status from outbox where id=$1", [f.queued])
            )[0].status,
            "paused",
          );
        },
      );
    } finally {
      await db.close();
    }
  });

  test("C3: local Composio recovery cannot replay an uncertain direct attempt", async (t) => {
    const f = await c1Fixture(),
      s = scenario(f),
      { db } = f;
    try {
      const m = await s.claim(),
        admission = await s.admit(m);
      assert(admission);
      await s.service();
      await s.value("brand_dispatch_uncertain", [m.id, admission]);
      const original = (
          await s.rows("select * from outbox where id=$1", [m.id])
        )[0],
        permit = (
          await s.rows(
            "select * from mail_brand_dispatch_admissions where id=$1",
            [admission],
          )
        )[0];
      await t.test(
        "C check/review/replacement/revocation leave uncertainty, Message-ID and admission untouched",
        async () => {
          await s.register();
          await s.verify();
          await s.register({
            connected_account_id: "ca_c3_uncertain_replacement",
          });
          await s.verify();
          await s.revoke();
          assert.deepEqual(
            (await s.rows("select * from outbox where id=$1", [m.id]))[0],
            original,
          );
          assert.deepEqual(
            (
              await s.rows(
                "select * from mail_brand_dispatch_admissions where id=$1",
                [admission],
              )
            )[0],
            permit,
          );
          assert.equal(await s.admit(m), null);
          assert.equal(await s.claim(), undefined);
          await s.service();
          await assert.rejects(
            db.query("update outbox set status='queued' where id=$1", [m.id]),
            /BRAND_RECONCILIATION_REQUIRED/,
          );
        },
      );
      await t.test(
        "a fictional late result reconciles exactly once, preserving brand history without another wire",
        async () => {
          await s.service();
          await s.value("mark_sent", [
            m.id,
            "c3-fictional-gmail-id",
            "c3-fictional-thread",
          ]);
          const sent = (
            await s.rows("select * from outbox where id=$1", [m.id])
          )[0];
          assert.equal(sent.status, "sent");
          assert.equal(sent.message_id_header, original.message_id_header);
          assert.equal(sent.send_attempts, original.send_attempts);
          const history = await s.rows(
            "select id,brand_snapshot,brand_provenance from messages where internet_message_id=$1",
            [m.message_id_header],
          );
          assert.equal(history.length, 1);
          assert.equal(history[0].brand_provenance, "dispatch_snapshot");
          assert.deepEqual(
            Object.keys(history[0].brand_snapshot as object).sort(),
            ["brand_code", "brand_id", "brand_name"],
          );
          await s.service();
          await s.value("mark_sent", [
            m.id,
            "c3-fictional-gmail-id",
            "c3-fictional-thread",
          ]);
          assert.deepEqual(
            await s.rows(
              "select id,brand_snapshot,brand_provenance from messages where internet_message_id=$1",
              [m.message_id_header],
            ),
            history,
          );
          assert.equal(
            (
              await s.rows(
                "select count(*) n from mail_brand_dispatch_admissions where outbox_id=$1",
                [m.id],
              )
            )[0].n,
            1,
          );
          assert.equal(await s.admit(m), null);
        },
      );
    } finally {
      await db.close();
    }
  });

  test("C3: complete catalog, business rows and previous grants survive C apply/history/rollback/reapply", async () => {
    const f = await c1Fixture(false),
      s = scenario(f),
      { db } = f;
    const catalog = async () => ({
      functions: await s.rows(
        "select p.oid::regprocedure::text key,md5(pg_get_functiondef(p.oid)) definition,p.proacl::text acl,p.proowner::regrole::text owner,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','s01_i02','brand_b1','brand_b2') order by key",
      ),
      tables: await s.rows(
        "select c.relname key,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text owner,c.relacl::text acl,(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) columns from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by key",
      ),
      constraints: await s.rows(
        "select c.relname||'.'||x.conname key,pg_get_constraintdef(x.oid) definition,x.convalidated from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by key",
      ),
      policies: await s.rows(
        "select c.relname||'.'||p.polname key,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) withcheck from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by key",
      ),
      triggers: await s.rows(
        "select c.relname||'.'||t.tgname key,t.tgenabled,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by key",
      ),
      indexes: await s.rows(
        "select indexname key,indexdef definition from pg_indexes where schemaname='public' order by key",
      ),
    });
    try {
      const before = await catalog(),
        business = await s.business(true),
        sql = await readFile(c1Sql, "utf8");
      await db.exec(
        "begin;set local pipeline_os.block_c_local='in_memory_test'",
      );
      await db.exec(
        sql
          .replace(/^([\s\S]*?)begin;/, (_m, c) => c)
          .replace(/commit;\s*$/, ""),
      );
      await s.register();
      await s.verify();
      await s.register({ connected_account_id: "ca_c3_rollback_history" });
      await s.verify();
      await s.revoke();
      const installed = await catalog();
      for (const group of Object.keys(before) as (keyof typeof before)[]) {
        const prior = new Map(before[group].map((row) => [row.key, row]));
        assert.deepEqual(
          installed[group].filter((row) => prior.has(row.key)),
          before[group],
        );
        for (const row of installed[group].filter((row) => !prior.has(row.key)))
          assert(
            /^(composio_|mail_provider_binding)/.test(String(row.key)),
            "Unexpected legacy catalog addition",
          );
      }
      assert.equal(
        (
          await s.rows(
            "select count(*) n from mail_provider_binding_checks where confirmed_at is not null",
          )
        )[0].n,
        2,
      );
      await db.exec("rollback");
      assert.deepEqual(await catalog(), before);
      assert.deepEqual(await s.business(true), business);
      assert.equal(
        (await s.rows("select to_regnamespace('composio_c1')::text name"))[0]
          .name,
        null,
      );
      await db.exec("set pipeline_os.block_c_local='in_memory_test'");
      await db.exec(sql);
      await s.register();
      await f.asUser(f.users.admin);
      assert.equal((await f.page()).current?.status, "candidate");
      assert.equal((await f.page()).head_revision, 1);
      assert.equal(
        (await s.rows("select count(*) n from mail_provider_binding_checks"))[0]
          .n,
        0,
      );
    } finally {
      await db.close();
    }
  });

  test("C3: worker/facade import graph cannot reach C administration/verifier or select a C status", async () => {
    const roots = [
        "src/lib/server/google.ts",
        "worker/gmail.ts",
        "worker/campaigns.ts",
        "worker/notifications.ts",
      ],
      seen = new Set<string>();
    let selections = 0;
    // TypeScript7's native package does not export the former compiler AST API.
    const parser = createRequire(import.meta.url)(
      "next/dist/compiled/babel/parser",
    ) as {
      parse(
        source: string,
        options: { sourceType: string; plugins: string[] },
      ): unknown;
    };
    async function visit(path: string): Promise<void> {
      path = resolve(path);
      if (seen.has(path)) return;
      seen.add(path);
      assert(
        !/[/\\]mail-accounts[/\\]composio-(binding|verifier)\.ts$/.test(path),
      );
      assert(!path.endsWith("composio-bindings.ts"));
      const source = await readFile(path, "utf8"),
        tree = parser.parse(source, {
          sourceType: "unambiguous",
          plugins: ["typescript", "jsx"],
        }),
        imports: string[] = [];
      function literal(node: unknown) {
        return node &&
          typeof node === "object" &&
          typeof (node as { value?: unknown }).value === "string"
          ? (node as { value: string }).value
          : null;
      }
      function walk(node: unknown): void {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        const n = node as Record<string, unknown>;
        if (
          path === resolve(roots[0]) &&
          n.type === "CallExpression" &&
          (n.callee as { name?: string })?.name === "createMailTransport"
        ) {
          const argument = (n.arguments as Record<string, unknown>[])[0];
          assert.equal(argument.type, "ObjectExpression");
          const properties = argument.properties as Record<string, unknown>[];
          assert(!properties.some((p) => p.type === "SpreadElement"));
          const provider = properties.filter(
            (p) =>
              literal(p.key) === "provider" ||
              (p.key as { name?: string })?.name === "provider",
          );
          assert.equal(provider.length, 1);
          assert.equal(literal(provider[0].value), "gmail_oauth");
          selections++;
        }
        if (
          [
            "ImportDeclaration",
            "ExportNamedDeclaration",
            "ExportAllDeclaration",
            "ImportExpression",
          ].includes(String(n.type))
        ) {
          const name = literal(n.source);
          if (name !== null) imports.push(name);
        }
        if (
          n.type === "CallExpression" &&
          (n.callee as { type?: string })?.type === "Import"
        ) {
          const name = literal((n.arguments as unknown[])[0]);
          assert(
            name !== null,
            "Dynamic relative import must be explicitly reviewed",
          );
          imports.push(name);
        }
        for (const [key, value] of Object.entries(n))
          if (!["loc", "start", "end", "comments", "tokens"].includes(key))
            walk(value);
      }
      walk(tree);
      for (const name of imports.filter((n) => n.startsWith("."))) {
        const base = resolve(dirname(path), name);
        let found: string | null = null;
        for (const candidate of [
          base,
          base + ".ts",
          base + ".tsx",
          resolve(base, "index.ts"),
          resolve(base, "index.tsx"),
        ]) {
          try {
            if ((await stat(candidate)).isFile()) {
              found = candidate;
              break;
            }
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
        }
        assert(found, "Unresolved relative source: " + name);
        await visit(found);
      }
    }
    for (const root of roots) await visit(root);
    assert(seen.size > 10);
    assert.equal(selections, 1);
    const google = await readFile(roots[0], "utf8");
    assert.match(google, /provider: "gmail_oauth"/);
    assert.doesNotMatch(
      google,
      /COMPOSIO_|composioBinding|provider: "composio"/,
    );
  });
}
