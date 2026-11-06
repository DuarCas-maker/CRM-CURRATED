import {
  installBrandDelivery,
  bindFixtureAccount,
  queueFixtureMail,
} from "./fixtures/pipeline-os-s02-brand-delivery";
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { OAuth2Client } from "google-auth-library";
import { encrypt } from "../src/lib/server/crypto";
import { featureDatabase } from "./feature-database";

if (!process.execArgv.includes("--experimental-test-module-mocks")) {
  test("A worker/facade composition in an isolated module-mock process", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--test",
        "tests/pipeline-os-s02-block-a-api.test.ts",
      ],
      { env, encoding: "utf8", timeout: 60000 },
    );
    assert.match(output, /# fail 0/);
  });
} else {
  test("A: actual worker + S01 static guards + S02 direct facade, with all external dependencies fake", async (t) => {
    const environment = {
      NEXT_PUBLIC_SUPABASE_URL: "https://block-a-db.example.test",
      SUPABASE_SERVICE_ROLE_KEY: "block-a-service-fixture",
      INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
      GOOGLE_OAUTH_ORGANIZATIONS: JSON.stringify([
        {
          id: "block-a",
          domain: "example.test",
          clientId: "123-block-a.apps.googleusercontent.com",
          clientSecret: "block-a-fixture",
          projectId: "block-a-project",
        },
      ]),
      // Even deliberately misleading env cannot select Composio in I01/A.
      COMPOSIO_API_KEY: "block-a-never-used-fixture",
      MAIL_TRANSPORT: "composio",
    };
    const prior = Object.fromEntries(
      Object.keys(environment).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, environment);
    let current: Awaited<ReturnType<typeof fixture>>;
    const events: string[] = [];
    let wire = 0,
      alerts = 0,
      mode = "success";
    let workerMock: ReturnType<typeof mock.module> | undefined;

    async function fixture() {
      const f = await featureDatabase();
      const account = randomUUID(),
        contact = randomUUID(),
        caseId = randomUUID(),
        message = randomUUID();
      await f.db.query(
        "insert into contacts(id,email,name,verification) values($1,'client@block-a.test','Fixture','valid')",
        [contact],
      );
      await f.db.query(
        "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
        [caseId, contact, f.users.seller],
      );
      await f.db.query(
        "insert into mail_accounts(id,email,organization) values($1,'sender@block-a.test','block-a')",
        [account],
      );
      await f.db.query(
        "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true)",
        [account, f.users.seller],
      );
      await f.db.exec("set pipeline_os.block_a_local='in_memory_test'");
      for (const name of [
        "a-brand-foundation.local.sql",
        "a-mail-permissions.local.sql",
      ])
        await f.db.exec(
          await readFile(
            "docs/specs/pipeline-os/s02/integration/migrations/" + name,
            "utf8",
          ),
        );
      await installBrandDelivery(f);
      const preparation = await bindFixtureAccount(f, account, f.users.seller);
      const queued = await queueFixtureMail(
        f,
        account,
        f.users.seller,
        caseId,
        preparation,
      );
      const header = (
        await f.db.query<{ header: string }>(
          "select message_id_header header from outbox where id=$1",
          [queued],
        )
      ).rows[0].header;
      return {
        ...f,
        account,
        message: queued,
        header,
        brand: preparation.brand_id,
      };
    }
    const client = {
      rpc: async (name: string, p?: Record<string, string>) => {
        if (name === "claim_outbox") {
          events.push("claim");
          return {
            data: (await current.db.query("select * from claim_outbox()")).rows,
            error: null,
          };
        }
        if (name === "admit_brand_dispatch") {
          events.push("recheck");
          return {
            data: (
              await current.db.query<{ allowed: string | null }>(
                "select admit_brand_dispatch($1,$2) allowed",
                [p!.message, p!.claim_token],
              )
            ).rows[0].allowed,
            error: null,
          };
        }
        if (name === "brand_dispatch_uncertain") {
          await current.db.query("select brand_dispatch_uncertain($1,$2)", [
            p!.message,
            p!.admission,
          ]);
          return { data: null, error: null };
        }
        if (name === "mark_sent") {
          events.push("mark_sent");
          await current.db.query("select mark_sent($1,$2,$3)", [
            p!.outbox_id,
            p!.gmail_id,
            p!.thread_id,
          ]);
          return { data: null, error: null };
        }
        throw Error("Unexpected worker RPC " + name);
      },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              assert.equal(table, "mail_accounts");
              return { data: { email: "sender@block-a.test" }, error: null };
            },
          }),
        }),
        update: (value: Record<string, unknown>) => ({
          eq: (key: string, id: string) => {
            assert.equal(table, "outbox");
            assert.equal(key, "id");
            assert.equal(id, current.message);
            assert(
              Object.keys(value).every((k) =>
                ["attachment_snapshot", "status", "last_error"].includes(k),
              ),
            );
            const entries = Object.entries(value);
            const run = current.db
              .query(
                `update outbox set ${entries.map(([k], i) => `${k}=$${i + 1}${k === "attachment_snapshot" ? "::jsonb" : ""}`).join(",")} where id=$${entries.length + 1} and status<>'sent'`,
                [
                  ...entries.map(([k, v]) =>
                    k === "attachment_snapshot" ? JSON.stringify(v) : v,
                  ),
                  id,
                ],
              )
              .then(() => ({ data: null, error: null }));
            return { then: run.then.bind(run), neq: () => run };
          },
        }),
      }),
    };
    try {
      workerMock = mock.module(
        new URL("../worker/db.ts", import.meta.url).href,
        {
          namedExports: {
            db: () => client,
            checked: (r: { data: unknown; error: unknown }) => {
              assert.equal(r.error, null);
              return r.data;
            },
            alertAdmins: async () => {
              alerts++;
            },
          },
        },
      );
      t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => {
        events.push("oauth");
        return { token: "block-a-access-fixture" };
      });
      t.mock.method(
        globalThis,
        "fetch",
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(input));
          if (url.hostname === "block-a-db.example.test") {
            if (url.pathname.endsWith("/mail_accounts"))
              return Response.json({
                id: current.account,
                status: "connected",
                organization: "block-a",
              });
            if (url.pathname.endsWith("/mail_credentials"))
              return Response.json({
                encrypted_refresh_token: encrypt("block-a-refresh-fixture"),
              });
            if (url.pathname.endsWith("/reserve_gmail_api")) {
              const p = JSON.parse(String(init?.body));
              events.push("reserve");
              assert.deepEqual(p, {
                account: current.account,
                project: "block-a-project",
                units: 100,
              });
              const units = (
                await current.db.query<{ delay: number }>(
                  "select reserve_gmail_api($1,$2,$3) delay",
                  [p.account, p.project, p.units],
                )
              ).rows[0].delay;
              if (mode === "revoked")
                await current.db.query(
                  "update profiles set active=false where id=$1",
                  [current.users.seller],
                );
              return Response.json(units);
            }
            throw Error("Unexpected fake database URL");
          }
          assert.equal(
            url.href,
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          );
          assert.equal(init?.method, "POST");
          assert.equal(
            new Headers(init?.headers).get("authorization"),
            "Bearer block-a-access-fixture",
          );
          assert.equal(events.at(-1), "recheck");
          const body = JSON.parse(String(init?.body));
          assert(
            Buffer.from(body.raw, "base64url")
              .toString()
              .includes(`Message-ID: ${current.header}`),
          );
          events.push("wire");
          wire++;
          if (mode === "uncertain") throw Error("Simulated lost response");
          return Response.json({ id: "a123", threadId: "b456" });
        },
      );
      const { sendNext } = await import("../worker/gmail");
      for (const scenario of ["success", "revoked", "uncertain"])
        await t.test(scenario, async () => {
          current = await fixture();
          mode = scenario;
          events.length = 0;
          wire = 0;
          alerts = 0;
          try {
            await sendNext();
            const result = (
              await current.db.query<{
                status: string;
                last_error: string | null;
              }>("select status,last_error from outbox where id=$1", [
                current.message,
              ])
            ).rows[0];
            assert.deepEqual(events.slice(0, 4), [
              "claim",
              "oauth",
              "reserve",
              "recheck",
            ]);
            assert.equal(wire, scenario === "revoked" ? 0 : 1);
            if (scenario === "success") {
              assert.equal(result.status, "sent");
              assert.equal(alerts, 0);
              assert.equal(events.at(-1), "mark_sent");
            } else if (scenario === "revoked") {
              assert.equal(result.status, "paused");
              assert.equal(result.last_error, "BRAND_PREPARATION_STALE");
              assert.equal(alerts, 0);
            } else {
              assert.equal(result.status, "uncertain");
              assert.equal(result.last_error, "SEND_RESULT_UNCERTAIN");
              assert.equal(alerts, 1);
              assert(!events.includes("mark_sent"));
            }
            assert.equal(
              (
                await current.db.query<{ operating_brand_id: string | null }>(
                  "select operating_brand_id from mail_accounts where id=$1",
                  [current.account],
                )
              ).rows[0].operating_brand_id,
              current.brand,
            );
          } finally {
            await current.db.close();
          }
        });
    } finally {
      workerMock?.restore();
      t.mock.restoreAll();
      for (const key of Object.keys(environment)) {
        if (prior[key] === undefined) delete process.env[key];
        else process.env[key] = prior[key];
      }
    }
  });
}
