import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mailboxFixture } from "./pipeline-os-s02-mailbox-runtime";
import { runtimeConfiguration } from "./pipeline-os-s02-transport-runtime";
import {
  createConnectStore,
  type ConnectRpcClient,
} from "../../src/lib/server/mail-accounts/composio-connect/store";
import { createConnectSecrets } from "../../src/lib/server/mail-accounts/composio-connect/secrets";
import { createConnectProvider } from "../../src/lib/server/mail-accounts/composio-connect/provider";
import { createComposioConnectOrchestrator } from "../../src/lib/server/mail-accounts/composio-connect/orchestrator";
import {
  connectAuthority,
  connectDigest,
} from "../../src/lib/server/mail-accounts/composio-connect/session";
import type {
  ConnectConfig,
  ConnectStoreCommand,
  ConnectSnapshot,
} from "../../src/lib/composio-connect";
export const t009Sql =
  "docs/specs/pipeline-os/s02/connect-gmail/migrations/connect-t009.local.sql";
export async function connectStoreCompositionFixture(install = true) {
  const f = await mailboxFixture();
  try {
    await f.owner();
    const receipt = JSON.parse(
      await readFile(
        "docs/specs/pipeline-os/s02/integration/connect-store/t009-upstream-receipt.json",
        "utf8",
      ),
    );
    const sql = await readFile(t009Sql, "utf8"),
      rollback = await readFile(
        t009Sql.replace(".local.sql", ".rollback.sql"),
        "utf8",
      );
    for (const [p, s] of [
      [t009Sql, sql],
      [t009Sql.replace(".local.sql", ".rollback.sql"), rollback],
    ])
      assert.equal(
        createHash("sha256").update(s).digest("hex"),
        receipt.sourceFiles.find((x: { path: string }) => x.path === p).sha256,
      );
    const marker = "create schema composio_connect_runtime;",
      start = sql.indexOf(marker);
    assert(start > 0);
    const prefix = sql.slice(0, start);
    for (const expected of [
      "CONNECT_T009_LOCAL_ONLY",
      "f2_connect_owner",
      "inet_server_addr()",
      "CONNECT_T009_EMPTY_BASE_REQUIRED",
    ])
      assert(prefix.includes(expected));
    assert.equal(
      await f.scalar("select count(*)::int v from composio_connect.attempts"),
      0,
    );
    await f.db.exec("set pipeline_os.cw3_local='in_memory_test'");
    const installMemory = async () => {
      await f.owner();
      assert.equal(
        await f.scalar("select current_setting('pipeline_os.cw3_local') v"),
        "in_memory_test",
      );
      await f.db.exec(sql.slice(start).replace(/commit;\s*$/, ""));
    };
    const rollbackMemory = async () => {
      await f.owner();
      const guard = rollback.indexOf(
        " if exists(select 1 from composio_connect_runtime.runtime",
      );
      assert(guard > 0);
      await f.db.exec(
        ("do $guard$ begin\n" + rollback.slice(guard)).replace(
          /commit;\s*$/,
          "",
        ),
      );
    };
    if (install) await installMemory();
    const clock = {
      now: Date.now,
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (h: unknown) =>
        clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    const descriptor = {
      enabled: true as const,
      config: {
        generation: 2,
        project_id: f.config.project_id,
        auth_config_id: f.config.auth_config_id,
        quota_project_id: f.config.quota_project_id,
        owner_id: "crm-mail:template",
        callback_mode: "standard" as const,
      },
      context: runtimeConfiguration().context,
      callback_origin: "https://cw3.example.test",
    };
    const session = {
      actor_id: f.users.admin,
      session_id: f.sessions.get(f.users.admin)!,
      role: "superadmin" as const,
      active: true,
      aal: "aal2" as const,
      authorization_revision: await f.scalar<number>(
        "select mail_authorization_revision::int v from profiles where id=$1",
        [f.users.admin],
      ),
      expires_at_ms: Date.now() + 3_600_000,
    };
    const rpcCalls: string[] = [];
    const params: Record<string, string[]> = {
      composio_connect_runtime_publish: ["p"],
      composio_connect_runtime_authorize: ["operation", "p"],
      composio_connect_runtime_execute: ["operation", "p", "ticket"],
      composio_connect_runtime_register: ["operation", "p", "ticket"],
      composio_connect_runtime_ledger: ["operation", "p"],
    };
    const client = (human: boolean): ConnectRpcClient => ({
      rpc: async (name, p) => {
        try {
          const keys = params[name];
          assert(keys);
          rpcCalls.push(name);
          if (human) await f.human();
          else await f.service();
          return {
            data: await f.scalar(
              `select public.${name}(${keys.map((_, i) => "$" + (i + 1)).join(",")}) v`,
              keys.map((k) => p[k]),
            ),
            error: null,
          };
        } catch (e) {
          return { data: null, error: { message: (e as Error).message } };
        }
      },
    });
    const secrets = createConnectSecrets({
      activeKeyId: "fixture",
      keys: { fixture: Buffer.alloc(32, 17) },
      randomBytes,
    });
    const configFor = (config: ConnectConfig) => ({ ...descriptor, config });
    const api = createConnectStore({
      human: client(true),
      service: client(false),
      secrets,
      session: async () => structuredClone(session),
      now: Date.now,
      uuid: randomUUID,
      proof: () => randomBytes(24).toString("base64url"),
      configuration: configFor,
    });
    if (install) {
      const published = await client(false).rpc(
        "composio_connect_runtime_publish",
        { p: descriptor },
      );
      if (published.error) throw Error(JSON.stringify(published.error));
    }
    async function begin(
      mode: "new" | "existing" | "reconnect" = "new",
      account = f.accounts[0],
    ) {
      const id = randomUUID(),
        proof = randomBytes(24).toString("base64url"),
        state = randomBytes(32).toString("base64url");
      await f.owner();
      const intent = {
        attempt_id: id,
        idempotency_key: randomUUID(),
        browser_proof: proof,
        callback_state: state,
        mode,
        brand_id: f.brandA.brand_id,
        expected_brand_revision: await f.scalar<number>(
          "select revision::int v from operating_brands where id=$1",
          [f.brandA.brand_id],
        ),
        expected_account_revision:
          mode === "new"
            ? 0
            : await f.scalar<number>(
                "select brand_revision::int v from mail_accounts where id=$1",
                [account],
              ),
        expected_head_revision:
          mode === "new"
            ? 0
            : await f.scalar<number>(
                "select coalesce((select revision from mail_provider_binding_heads where account_id=$1),0)::int v",
                [account],
              ),
        expected_config_generation: 2,
        ...(mode === "new"
          ? {
              email: `mailbox-${id.slice(0, 8)}@cw3.test`,
              organization: "fixture",
            }
          : { account_id: account }),
      };
      const result = await api.beginIntent(intent);
      return { proof, state, snapshot: result.snapshot };
    }
    type Attempt = Awaited<ReturnType<typeof begin>>;
    const authority = (a: Attempt) => connectAuthority(session, a.proof);
    const load = async (a: Attempt) =>
      (a.snapshot = (await api.store.load({
        attempt_id: a.snapshot.attempt.id,
        authority: authority(a),
      })) as ConnectSnapshot);
    const request = (a: Attempt) => ({
      attempt_id: a.snapshot.attempt.id,
      expected_revision: a.snapshot.attempt.revision,
      idempotency_key: randomUUID(),
      browser_proof: a.proof,
    });
    const command = (a: Attempt): ConnectStoreCommand => ({
      attempt_id: a.snapshot.attempt.id,
      expected_revision: a.snapshot.attempt.revision,
      idempotency_key: randomUUID(),
      fingerprint: connectDigest(randomUUID()),
      command: "register",
      authority: authority(a),
      expected_context_hash: a.snapshot.attempt.context_hash,
    });
    const counters = { links: 0, reads: 0 };
    async function engine(a: Attempt, email?: string, networkFailure = false) {
      const cfg = await api.bindConfiguration({
        attempt_id: a.snapshot.attempt.id,
        authority: authority(a),
      });
      const provider = createConnectProvider({
        configuration: cfg,
        expectedConfiguration: cfg,
        credential: {
          version: cfg.context.credential_version,
          api_key: "fictional-cw3-key",
        },
        clock,
        fetchImpl: async (url, init) => {
          const path = new URL(String(url)).pathname,
            body = init?.body ? JSON.parse(String(init.body)) : null;
          if (path.endsWith("/link")) {
            counters.links++;
            if (networkFailure) throw Error("fixture-network-unknown");
            return Response.json(
              {
                connected_account_id:
                  "ca_" + a.snapshot.attempt.id.replaceAll("-", ""),
                redirect_url:
                  "https://connect.composio.dev/link/fictional_" +
                  a.snapshot.attempt.id.replaceAll("-", ""),
                expires_at: new Date(
                  a.snapshot.attempt.deadline_ms,
                ).toISOString(),
              },
              { status: 201 },
            );
          }
          counters.reads++;
          if (path.includes("/connected_accounts/"))
            return Response.json({
              id: a.snapshot.attempt.connection_id,
              user_id: cfg.config.owner_id,
              toolkit: { slug: "gmail" },
              authScheme: "OAUTH2",
              auth_config: {
                id: cfg.config.auth_config_id,
                auth_scheme: "OAUTH2",
                is_disabled: false,
              },
              status: "ACTIVE",
              is_disabled: false,
            });
          if (path.includes("/auth_configs/"))
            return Response.json({
              id: cfg.config.auth_config_id,
              toolkit: { slug: "gmail" },
              auth_scheme: "OAUTH2",
              status: "ENABLED",
            });
          assert.equal(
            body.connected_account_id,
            a.snapshot.attempt.connection_id,
          );
          assert.equal(
            body.endpoint,
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          );
          return Response.json({
            status: 200,
            data: {
              emailAddress: email ?? a.snapshot.attempt.expected_mailbox_email,
            },
          });
        },
      });
      return createComposioConnectOrchestrator({
        store: api.store,
        provider,
        session: { readCurrent: async () => structuredClone(session) },
        clock,
        callbackOrigin: cfg.callback_origin,
      });
    }
    async function connect(a: Attempt, email?: string) {
      let e = await engine(a);
      await e.start(request(a));
      await load(a);
      e = await engine(a, email);
      await e.callback({
        ...request(a),
        state: a.state,
        status: "success",
        connected_account_id: a.snapshot.attempt.connection_id!,
      });
      await load(a);
      return e;
    }
    async function adopt(a: Attempt) {
      await f.owner();
      const row = await f.scalar<{
        id: string;
        revision: number;
        expected_account_revision: number;
      }>(
        "select to_jsonb(r) v from mail_account_brand_reviews r where id=(select review_id from composio_connect.attempts where id=$1)",
        [a.snapshot.attempt.id],
      );
      await f.human();
      await f.command("brand_mapping_confirm", {
        review_id: row.id,
        expected_review_revision: row.revision,
        expected_account_revision: row.expected_account_revision,
        acknowledge_conflict: false,
      });
      a.snapshot = await api.adoptBrand(command(a), row.id);
    }
    return {
      ...f,
      brandCommand: f.command,
      api,
      descriptor,
      session,
      client,
      begin,
      load,
      request,
      command,
      engine,
      connect,
      adopt,
      counters,
      rpcCalls,
      installMemory,
      rollbackMemory,
      sourceSql: sql,
      sourceRollback: rollback,
    };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}
