import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { c1Fixture, c1Candidate } from "./pipeline-os-s02-composio-bindings";
import { bindingExpected } from "../../src/lib/composio-bindings";
import {
  verificationContextHash,
  verifyComposioBinding,
  requiredComposioScopes,
} from "../../src/lib/server/mail-accounts/composio-verifier";
import type { TransportPage } from "../../src/lib/mail-transport-selection";

export const r06SqlPath =
  "docs/specs/pipeline-os/s02/transport-selection/migrations/r06.local.sql";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function transportFixture(install = true) {
  const f = await c1Fixture(),
    { db, users } = f;
  const owner = () => db.exec("reset role;set request.jwt.claims='{}'");
  const service = async () => {
    await owner();
    await db.exec("set role service_role");
  };
  const scalar = async <T>(sql: string, p: unknown[] = []) =>
    (await db.query<{ v: T }>(sql, p)).rows[0].v;
  const sessions = new Map<string, string>();
  async function human(user = users.admin, aal = "aal2") {
    await owner();
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: user,
        session_id: sessions.get(user),
        aal,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ]);
    await db.exec("set role authenticated");
  }
  try {
    await owner();
    await db.exec(
      "create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),refreshed_at timestamptz default now(),not_after timestamptz)",
    );
    for (const user of Object.values(users)) {
      const s = randomUUID();
      sessions.set(user, s);
      await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
        s,
        user,
      ]);
    }
    const connect = await readFile(
      "docs/specs/pipeline-os/s02/connect-gmail/migrations/connect-t002.local.sql",
      "utf8",
    );
    const receipt = JSON.parse(
      await readFile(
        "docs/specs/pipeline-os/s02/integration/connect-worker/manifest.json",
        "utf8",
      ),
    );
    assert.equal(digest(connect), receipt.upstream.files[0].sha256);
    const marker = "create schema composio_connect;";
    assert.equal(connect.split(marker).length, 2);
    const prefix = connect.slice(0, connect.indexOf(marker));
    for (const s of [
      "CONNECT_T002_LOCAL_ONLY",
      "f2_connect_owner",
      "inet_server_addr()",
      "CONNECT_T002_BASE_REQUIRED",
    ])
      assert(prefix.includes(s));
    await db.exec(
      connect.slice(connect.indexOf(marker)).replace(/commit;\s*$/, ""),
    ); // Fixture-only native host guard adaptation, no disk mutation.
    await db.exec("set pipeline_os.worker_control_local='in_memory_test'");
    await db.exec(
      await readFile(
        "docs/specs/pipeline-os/s02/worker-control/migrations/worker-control.local.sql",
        "utf8",
      ),
    );
    await service();
    const config = {
      generation: 1,
      project_id: c1Candidate.composio_project_id,
      auth_config_id: c1Candidate.auth_config_id,
      quota_project_id: c1Candidate.google_quota_project_id,
      policy_reviewed: true,
      max_age_seconds: 3600,
      inactivity_seconds: 1800,
    };
    await db.query("select composio_connect_publish($1)", [config]);
    await owner();
    await db.query(
      "insert into mail_credentials(account_id,encrypted_refresh_token) values($1,'second-fictional-token')",
      [f.accounts[1]],
    );
    if (install) {
      await db.exec("set pipeline_os.r06_local='in_memory_test'");
      await db.exec(await readFile(r06SqlPath, "utf8"));
    }
    async function expected(account = f.accounts[0], target = "gmail_oauth") {
      await owner();
      const ctx = await scalar<Record<string, unknown>>(
        "select mail_runtime.context($1) v",
        [account],
      );
      return {
        expected_revision: Number(
          await scalar(
            "select coalesce((select revision from mail_runtime.routes where account_id=$1),0)::int v",
            [account],
          ),
        ),
        target_provider: target,
        expected_head_revision: Number(
          await scalar(
            "select coalesce((select revision from mail_provider_binding_heads where account_id=$1),0)::int v",
            [account],
          ),
        ),
        expected_account_revision: ctx.account_revision,
        expected_brand_revision: ctx.brand_revision,
        expected_config_generation: Number(
          await scalar(
            "select generation::int v from composio_connect.configuration where id=1",
          ),
        ),
        expected_context_hash: await scalar(
          "select mail_runtime.digest(mail_runtime.context($1)::text) v",
          [account],
        ),
      };
    }
    async function run(
      kind: string,
      target = "gmail_oauth",
      account = f.accounts[0],
      p?: object,
      key = randomUUID(),
    ) {
      const value = p ?? (await expected(account, target));
      await human();
      return scalar<TransportPage>(
        "select mail_transport_command($1,$2,$3,$4) v",
        [account, kind, value, key],
      );
    }
    async function acquire(
      operation = "profile",
      resource = operation,
      account = f.accounts[0],
    ) {
      await owner();
      const revision = await scalar<number>(
        "select revision::int v from mail_runtime.routes where account_id=$1",
        [account],
      );
      const cap = randomBytes(32).toString("hex");
      await service();
      const ticket = await scalar<{
        id: string;
        provider: string;
        revision: number;
        binding: Record<string, unknown> | null;
      }>("select mail_transport_acquire($1,$2,$3,$4,$5) v", [
        account,
        revision,
        operation,
        resource,
        digest(cap),
      ]);
      return { ticket, cap };
    }
    async function verifyAndConfirm(account = f.accounts[0]) {
      const context = {
        composio_project_id: c1Candidate.composio_project_id,
        credential_version: "fixture-version-1",
        google_quota_project_id: c1Candidate.google_quota_project_id,
        auth_config_revision: "fixture-r1",
        provenance_reference: "fixture-reviewed",
        project_provenance: "server_reviewed",
        quota_provenance: "oauth_client_reviewed",
      };
      const contextHash = verificationContextHash(context)!;
      await service();
      await db.query("select composio_binding_check_context($1,$2)", [
        account,
        contextHash,
      ]);
      await human();
      const page = await f.page(account);
      assert(page.current);
      const nonce = randomBytes(32).toString("hex");
      const check = await scalar<{ id: string }>(
        "select composio_binding_check_begin($1,$2,$3,$4,$5,$6) v",
        [
          account,
          page.current.id,
          bindingExpected(page),
          contextHash,
          digest(nonce),
          randomUUID(),
        ],
      );
      await service();
      const target = await scalar<Record<string, string>>(
        "select composio_binding_check_snapshot($1,$2,$3) v",
        [check.id, nonce, contextHash],
      );
      const facts = await verifyComposioBinding(target, context, {
        connection: async () => ({
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
            provenance_reference: "fixture-effective",
            source: "effective_grants",
          },
        }),
        authConfig: async () => ({
          id: target.auth_config_id,
          toolkit: "gmail",
          enabled: true,
          revision: "fixture-r1",
          declared_scopes: [...requiredComposioScopes],
        }),
        profile: async () => ({
          connected_account_id: target.connected_account_id,
          primary_email: target.expected_mailbox_email,
        }),
      });
      assert.equal(facts.permissions, true);
      await db.query("select composio_binding_check_finish($1,$2,$3,$4)", [
        check.id,
        nonce,
        contextHash,
        facts,
      ]);
      await human();
      const current = await f.page(account);
      const result = await f.commandC(
        "confirm_binding",
        {
          ...bindingExpected(current),
          binding_id: page.current.id,
          check_id: check.id,
        },
        account,
      );
      return { ...result, check: check.id, contextHash };
    }
    async function onboard() {
      const email = randomUUID() + "@example.test",
        proof = randomUUID(),
        capability = randomUUID();
      await human();
      let a = await scalar<{
        id: string;
        revision: number;
        review_id?: string;
      }>("select composio_connect_begin($1,$2) v", [
        {
          mode: "new",
          email,
          organization: "fixture",
          brand_id: f.brandA.brand_id,
          expected_brand_revision: 1,
          expected_account_revision: 0,
          expected_head_revision: 0,
          expected_config_generation: 1,
          state_hash: digest(randomUUID()),
          browser_hash: digest(proof),
          capability_hash: digest(capability),
        },
        randomUUID(),
      ]);
      await owner();
      const stored = await scalar<Record<string, string>>(
        "select to_jsonb(x) v from composio_connect.attempts x where id=$1",
        [a.id],
      );
      await service();
      a = await scalar("select composio_connect_observe($1,$2,$3,$4) v", [
        a.id,
        a.revision,
        capability,
        {
          project_id: stored.project_id,
          auth_config_id: stored.auth_config_id,
          owner_id: stored.owner_id,
          connection_id: "ca_" + randomUUID().replaceAll("-", ""),
          primary_email: email,
          active: true,
          toolkit: "gmail",
        },
      ]);
      await human();
      a = await scalar(
        "select composio_connect_command($1,'materialize',$2,$3,$4) v",
        [a.id, a.revision, proof, randomUUID()],
      );
      await owner();
      const review = await scalar<Record<string, unknown>>(
        "select to_jsonb(r) v from mail_account_brand_reviews r where id=$1",
        [a.review_id],
      );
      await human();
      await f.command("brand_mapping_confirm", {
        review_id: review.id,
        expected_review_revision: review.revision,
        expected_account_revision: review.expected_account_revision,
        acknowledge_conflict: false,
      });
      a = await scalar(
        "select composio_connect_command($1,'adopt_brand',$2,$3,$4,$5) v",
        [a.id, a.revision, proof, randomUUID(), review.id],
      );
      a = await scalar(
        "select composio_connect_command($1,'register',$2,$3,$4) v",
        [a.id, a.revision, proof, randomUUID()],
      );
      await owner();
      const account = await scalar<ReturnType<typeof randomUUID>>(
        "select id v from mail_accounts where email=$1",
        [email],
      );
      return { account, email, attempt: a.id };
    }
    return {
      ...f,
      owner,
      service,
      human,
      scalar,
      sessions,
      config,
      expected,
      run,
      acquire,
      verifyAndConfirm,
      onboard,
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}
