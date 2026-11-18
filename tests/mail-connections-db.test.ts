import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connectV2Fixture } from "./fixtures/pipeline-os-s02-connect-v2";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bindingPageV2,
  bindingCheckV2,
  bindingCommandV2,
  type BindingV2Ports,
} from "../src/lib/server/mail-accounts/composio-binding-v2";
import { bindingExpected } from "../src/lib/composio-bindings";
import { withMailQuota } from "../src/lib/server/mail-quota";
import {
  existingVerificationHash,
  existingVerificationContext,
} from "../src/lib/server/mail-accounts/composio-existing-verifier";
import { queueFixtureMail } from "./fixtures/pipeline-os-s02-brand-delivery";

const folder = "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/";
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
test(
  "Simple mail SQL: real role/MFA, identity, advisor, replay, included budget and preservation",
  { timeout: 120000 },
  async (t) => {
    const f = await connectV2Fixture();
    const scalar = f.scalar;
    f.scalar = (async (...args: Parameters<typeof scalar>) => {
      try {
        return await scalar(...args);
      } catch (e) {
        const err = e as { message: string; where?: string };
        throw Error(err.message + (err.where ? " :: " + err.where : ""));
      }
    }) as typeof scalar;
    try {
      await f.owner();
      const i04 = await readFile(
        "docs/specs/pipeline-os/s02/release/quota-final/052_integrate_mail_quota_and_existing_bindings.sql",
        "utf8",
      );
      const start = i04.indexOf("create table mail_quota.binding_contexts(");
      const end = i04.indexOf("\ndo $qgr$", start);
      assert.ok(start > 0 && end > start);
      // Canonical 052 declarations on a synthetic embedded fixture; no production guards/protocol execution.
      await f.db.exec(i04.slice(start, end));
      await f.db.exec(await readFile(folder + "simple-mail.local.sql", "utf8"));
      await f.db.exec(
        await readFile(folder + "simple-mail.rollback.sql", "utf8"),
      );
      await f.db.exec(await readFile(folder + "simple-mail.local.sql", "utf8"));
      await f.human();
      const brand = await f.scalar<any>(
        "select crm_command('brand_create',$1,$2) v",
        [
          { code: "curated_financial", name: "Curated Financial", active: true },
          randomUUID(),
        ],
      );
      const input = {
        email: "new.simple@example.test",
        provider: "gmail_oauth",
        advisor_id: f.users.seller,
        idempotency_key: randomUUID(),
      };
      const state = digest(randomUUID());
      const begin = () =>
        f.scalar<any>("select simple_mail_begin($1,$2,$3,$4,$5) v", [
          input,
          state,
          "fictional-encrypted-state",
          "fixture",
          "example.test",
        ]);
      let record: any;
      await t.test(
        "human begins with fixed brand; duplicate returns same receipt",
        async () => {
          record = await begin();
          assert.equal(record.state, "prepared");
          assert.equal(record.advisor_id, f.users.seller);
          assert.equal((await begin()).id, record.id);
          const changed = { ...input, email: "different@example.test" };
          await assert.rejects(
            f.scalar("select simple_mail_begin($1,$2,$3,$4,$5) v", [
              changed,
              state,
              "encrypted",
              "fixture",
              "example.test",
            ]),
            /SIMPLE_CONFLICT/,
          );
        },
      );
      await t.test(
        "advisor required and mailbox domain mismatch denied",
        async () => {
          for (const p of [
            {
              email: "no.owner@example.test",
              provider: "gmail_oauth",
              idempotency_key: randomUUID(),
            },
            {
              ...input,
              email: "wrong@foreign.test",
              idempotency_key: randomUUID(),
            },
          ])
            await assert.rejects(
              f.scalar(
                "select simple_mail_begin($1,$2,$3,'fixture','example.test') v",
                [p, digest(randomUUID()), "fictional-state"],
              ),
              /SIMPLE_ADVISOR_REQUIRED|SIMPLE_INVALID_INPUT/,
            );
        },
      );
      await t.test("MFA and session ownership enforced in DB", async () => {
        await f.owner();
        await f.db.exec("set role anon");
        await assert.rejects(
          f.scalar("select simple_mail_options() v"),
          /permission denied/,
        );
        await f.human(f.users.seller);
        await assert.rejects(
          f.scalar("select simple_mail_get($1) v", [record.id]),
          /BRAND_FORBIDDEN|SIMPLE_FORBIDDEN/,
        );
        await f.human();
      });
      await t.test(
        "public identity assertion cannot save a credential",
        async () => {
          await assert.rejects(
            f.scalar("select simple_mail_direct_saved($1,$2,$3,$4) v", [
              record.id,
              f.users.admin,
              input.email,
              "fictional-encrypted-token",
            ]),
            /permission denied/,
          );
          await f.service();
          await assert.rejects(
            f.scalar("select simple_mail_direct_saved($1,$2,$3,$4) v", [
              record.id,
              f.users.admin,
              "other@example.test",
              "fictional-encrypted-token",
            ]),
            /SIMPLE_FORBIDDEN/,
          );
        },
      );
      await t.test(
        "server identity receipt and automatic brand confirmation",
        async () => {
          await f.human();
          assert.equal(
            await f.scalar("select simple_mail_exchange_begin($1) v", [
              record.id,
            ]),
            true,
          );
          assert.equal(
            await f.scalar("select simple_mail_exchange_begin($1) v", [
              record.id,
            ]),
            false,
          );
          await f.service();
          const saved = await f.scalar<any>(
            "select simple_mail_direct_saved($1,$2,$3,$4) v",
            [
              record.id,
              f.users.admin,
              input.email,
              "fictional-encrypted-token",
            ],
          );
          assert.equal(saved.state, "preparing");
          assert.ok(saved.account_id);
          record = saved;
          assert.equal(
            (
              await f.scalar<any>(
                "select simple_mail_direct_saved($1,$2,$3,$4) v",
                [
                  record.id,
                  f.users.admin,
                  input.email,
                  "fictional-encrypted-token",
                ],
              )
            ).account_id,
            record.account_id,
          );
          await f.human();
          await f.scalar("select simple_mail_confirm($1) v", [record.id]);
          await f.owner();
          assert.equal(
            await f.scalar(
              "select operating_brand_id=$2 v from mail_accounts where id=$1",
              [record.account_id, brand.id],
            ),
            true,
          );
        },
      );
      await t.test(
        "finalize grants selected advisor, starts thirty-day sync and never starts campaigns",
        async () => {
          await f.human();
          const ready = await f.scalar<any>(
            "select simple_mail_finalize($1) v",
            [record.id],
          );
          assert.equal(ready.state, "ready");
          assert.equal(
            (
              await f.scalar<any>("select simple_mail_finalize($1) v", [
                record.id,
              ])
            ).state,
            "ready",
          );
          await f.owner();
          assert.equal(
            await f.scalar(
              "select count(*)::int v from mail_permissions where account_id=$1 and user_id=$2 and can_send",
              [record.account_id, f.users.seller],
            ),
            1,
          );
          assert.equal(
            await f.scalar(
              "select count(*)::int v from mail_permissions where account_id=$1 and user_id=$2",
              [record.account_id, f.users.outsider],
            ),
            0,
          );
          assert.equal(
            await f.scalar(
              "select simple_mail_sync_from between now()-interval '30 days 1 minute' and now()-interval '29 days 23 hours' v from mail_accounts where id=$1",
              [record.account_id],
            ),
            true,
          );
          assert.equal(
            await f.scalar(
              "select count(*)::int v from outbox where account_id=$1",
              [record.account_id],
            ),
            0,
          );
        },
      );
      const dbClient = (role: "human" | "service") =>
        ({
          rpc: async (name: string, p: Record<string, unknown> = {}) => {
            assert.match(name, /^[a-z_0-9]+$/);
            for (const key of Object.keys(p)) assert.match(key, /^[a-z_0-9]+$/);
            try {
              if (role === "human") await f.human();
              else await f.service();
              return {
                data: await f.scalar(
                  `select public.${name}(${Object.keys(p)
                    .map((k, i) => `${k}=>$${i + 1}`)
                    .join(",")}) v`,
                  Object.values(p),
                ),
                error: null,
              };
            } catch (e) {
              return {
                data: null,
                error: { message: (e as Error).message.split(" :: ")[0] },
              };
            }
          },
        }) as unknown as SupabaseClient;
      let comp: any, binding: any;
      await t.test(
        "Composio identity, current-context candidate and effective scopes verify without another Google consent",
        async () => {
          await f.human();
          comp = await f.scalar<any>(
            "select simple_mail_begin($1,$2,'fictional-state','fixture','example.test') v",
            [
              { ...input, provider: "composio", idempotency_key: randomUUID() },
              digest(randomUUID()),
            ],
          );
          const option = await (
            await f.options("?account_id=" + record.account_id)
          ).json();
          const connectKey = randomUUID();
          const begun = await (
            await f.begin({
              mode: "existing",
              account_id: record.account_id,
              brand_id: brand.id,
              expected_brand_revision: 1,
              expected_account_revision: option.account.account_revision,
              expected_head_revision: option.account.head_revision,
              expected_config_generation: 3,
              idempotency_key: connectKey,
            })
          ).json();
          assert.ok(begun.status, begun.error);
          let view = begun.status;
          await f.human();
          await f.scalar("select simple_mail_update($1,$2,null) v", [
            comp.id,
            view.id,
          ]);
          const started = await (
            await f.action(view.id, "start", {
              expected_revision: view.revision,
              idempotency_key: randomUUID(),
            })
          ).json();
          assert.ok(started.status, started.error);
          await f.owner();
          const source = await f.scalar<any>(
            "select to_jsonb(a) v from composio_connect.attempts a where id=$1",
            [view.id],
          );
          const material = f.config.material(f.session, connectKey);
          const callback = new URL(
            "/api/mail/composio/connect/callback",
            f.config.descriptor.callback_origin,
          );
          callback.searchParams.set("state", material.state);
          callback.searchParams.set("status", "success");
          callback.searchParams.set(
            "connected_account_id",
            source.connection_id,
          );
          assert.equal((await f.callback(callback.href)).status, 303);
          let current = await (await f.status(view.id)).json();
          assert.ok(current.status, current.error);
          await f.human();
          await f.scalar("select simple_mail_confirm($1) v", [comp.id]);
          if (current.pending)
            current = await (
              await f.action(view.id, "adopt", {
                idempotency_key: randomUUID(),
              })
            ).json();
          if (current.status?.state === "ready_to_register")
            current = await (
              await f.action(view.id, "register", {
                expected_revision: current.status.revision,
                idempotency_key: randomUUID(),
              })
            ).json();
          assert.equal(current.status?.state, "completed", current.error);
          const context = existingVerificationContext.parse(
              f.config.descriptor.context,
            ),
            contextHash = existingVerificationHash(context)!;
          await f.service();
          await f.scalar(
            "select composio_binding_check_context_v2($1,$2,$3,$4) v",
            [
              record.account_id,
              source.auth_config_id,
              JSON.stringify(context),
              contextHash,
            ],
          );
          await f.human();
          await f.scalar(
            "select composio_binding_budget_v2($1,$2,4,$3,$4,true) v",
            [
              record.account_id,
              contextHash,
              new Date(Date.now() + 300000).toISOString(),
              randomUUID(),
            ],
          );
          const p: BindingV2Ports = {
            enabled: true,
            checksEnabled: true,
            human: dbClient("human"),
            service: () => dbClient("service"),
            descriptor: () => ({
              context,
              auth_config_id: source.auth_config_id,
            }),
            apiKey: () => "fictional-test-key",
            now: () => Date.now(),
            fetchImpl: async (url, init) => {
              const path = new URL(String(url)).pathname;
              if (path.includes("/connected_accounts/"))
                return Response.json({
                  id: source.connection_id,
                  user_id: source.owner_id,
                  authScheme: "OAUTH2",
                  toolkit: { slug: "gmail" },
                  auth_config: {
                    id: source.auth_config_id,
                    auth_scheme: "OAUTH2",
                    is_disabled: false,
                  },
                  status: "ACTIVE",
                  is_disabled: false,
                  updated_at: "fixture-r1",
                });
              if (path.includes("/auth_configs/"))
                return Response.json({
                  id: source.auth_config_id,
                  toolkit: { slug: "gmail" },
                  auth_scheme: "OAUTH2",
                  status: "ENABLED",
                  last_updated_at: context.auth_config_revision,
                });
              const body = JSON.parse(String(init?.body));
              if (body.endpoint === "https://oauth2.googleapis.com/tokeninfo")
                return Response.json({
                  status: 200,
                  data: {
                    aud: "fixture-audience",
                    scope:
                      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
                    expires_in: 3600,
                    email: input.email,
                    email_verified: true,
                  },
                });
              assert.match(body.endpoint, /gmail\/v1\/users\/me\/profile/);
              return Response.json({
                status: 200,
                data: { emailAddress: input.email, historyId: "1" },
              });
            },
          };
          let page = await bindingPageV2(p, record.account_id, null, 1);
          assert.ok(page.current);
          binding = page.current;
          const check = await withMailQuota(
            {
              enabled: true,
              rpc: async (name, args) => {
                const result = await dbClient("service").rpc(name, args);
                if (result.error) throw Error(result.error.message);
                return result.data;
              },
              now: Date.now,
              sleep: async () => {},
              uuid: randomUUID,
            },
            () =>
              bindingCheckV2(p, record.account_id, {
                contract_version: 2,
                binding_id: binding.id,
                expected: bindingExpected(page),
                idempotency_key: randomUUID(),
              }),
          );
          assert.equal(check.status, "completed");
          page = await bindingPageV2(p, record.account_id, null, 1);
          assert.ok(page.can_confirm);
          await bindingCommandV2(p, record.account_id, {
            contract_version: 2,
            kind: "confirm_binding",
            payload: {
              ...bindingExpected(page),
              binding_id: binding.id,
              check_id: check.id,
            },
            idempotency_key: randomUUID(),
          });
          await f.human();
          assert.equal(
            (
              await f.scalar<any>("select simple_mail_finalize($1) v", [
                comp.id,
              ])
            ).state,
            "ready",
          );
          await f.owner();
          assert.equal(
            await f.scalar(
              "select count(*)::int v from public.mail_provider_bindings where account_id=$1 and status='verified'",
              [record.account_id],
            ),
            1,
          );
        },
      );
      await t.test(
        "included usage is closed until evidence and uses all applicable meters",
        async () => {
          await f.service();
          assert.equal(
            await f.scalar("select simple_mail_included_available() v"),
            false,
          );
          await f.owner();
          await f.db.query(
            "insert into simple_mail.included values(true,$1,date_trunc('month',now()),date_trunc('month',now())+interval '1 month',now()+interval '5 minutes',true,'fictional-hard-cap-evidence',2,1)",
            [f.config.descriptor.context.composio_project_id],
          );
          await f.service();
          const key = randomUUID();
          assert.equal(
            await f.scalar("select simple_mail_included_reserve($1,$2,1,1) v", [
              key,
              record.account_id,
            ]),
            true,
          );
          assert.equal(
            await f.scalar("select simple_mail_included_reserve($1,$2,1,1) v", [
              key,
              record.account_id,
            ]),
            true,
          );
          assert.equal(
            await f.scalar("select simple_mail_included_reserve($1,$2,1,1) v", [
              randomUUID(),
              record.account_id,
            ]),
            false,
          );
          assert.equal(
            await f.scalar("select simple_mail_included_reserve($1,$2,1,0) v", [
              randomUUID(),
              record.account_id,
            ]),
            true,
          );
          assert.equal(
            await f.scalar("select simple_mail_included_reserve($1,$2,1,0) v", [
              randomUUID(),
              record.account_id,
            ]),
            false,
          );
        },
      );
      await t.test(
        "a saved Composio identity is adopted with fresh MFA without a new Connect attempt",
        async () => {
          await f.owner();
          const before = await f.scalar<number>(
            "select count(*)::int v from composio_connect.attempts",
          );
          await f.human();
          const recovered = await f.scalar<any>(
            "select simple_mail_begin($1,$2,'fictional-state','fixture','example.test') v",
            [
              { ...input, provider: "composio", idempotency_key: randomUUID() },
              digest(randomUUID()),
            ],
          );
          assert.equal(recovered.state, "preparing");
          await f.scalar("select simple_mail_confirm($1) v", [recovered.id]);
          assert.equal(
            (
              await f.scalar<any>("select simple_mail_finalize($1) v", [
                recovered.id,
              ])
            ).state,
            "ready",
          );
          await f.owner();
          assert.equal(
            await f.scalar<number>(
              "select count(*)::int v from composio_connect.attempts",
            ),
            before,
          );
        },
      );
      await t.test(
        "fallback SQL reserves one child, requires actual B2 admission and keeps uncertain messages held",
        async () => {
          await f.human();
          const review = await f.scalar<any>(
            "select mail_transport_review($1) v",
            [record.account_id],
          );
          const selected = await f.scalar<any>(
            "select mail_transport_command($1,'bootstrap_direct',$2,$3) v",
            [
              record.account_id,
              { ...review.expected, target_provider: "gmail_oauth" },
              randomUUID(),
            ],
          );
          assert.equal(selected.provider, "gmail_oauth");
          const queued = await queueFixtureMail(
            f as unknown as Parameters<typeof queueFixtureMail>[0],
            record.account_id,
            f.users.seller,
            f.opportunity,
            { brand_id: brand.id, brand_revision: 1, account_revision: 1 },
          );
          await f.service();
          let msg: any;
          for (let i = 0; i < 4 && !msg; i++) {
            const rows = (await f.db.query<any>("select * from claim_outbox()"))
              .rows;
            msg = rows.find((r) => r.id === queued);
          }
          assert.ok(
            msg,
            "Own fixture message is claimed by existing queue logic",
          );
          const proof = digest(randomUUID());
          const parent = await f.scalar<any>(
            "select mail_transport_acquire($1,$2,'send',$3,$4) v",
            [record.account_id, selected.revision, queued, digest(proof)],
          );
          await assert.rejects(
            f.scalar("select simple_mail_fallback_begin($1,$2,$3) v", [
              parent.id,
              proof,
              digest(randomUUID()),
            ]),
            /SIMPLE_NOT_READY/,
          );
          await f.scalar(
            "select mail_transport_finish($1,$2,'cancelled_before_wire') v",
            [parent.id, proof],
          );
          await f.owner();
          await f.db.exec(
            "update simple_mail.included set remaining_calls=2,remaining_proxy=1",
          );
          await f.service();
          assert.equal(
            await f.scalar("select simple_mail_backup_ready($1) v", [
              record.account_id,
            ]),
            true,
          );
          const childProof = digest(randomUUID());
          const race = await Promise.allSettled([
            f.scalar<any>("select simple_mail_fallback_begin($1,$2,$3) v", [
              parent.id,
              proof,
              digest(childProof),
            ]),
            f.scalar<any>("select simple_mail_fallback_begin($1,$2,$3) v", [
              parent.id,
              proof,
              digest(childProof),
            ]),
          ]);
          assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
          assert.equal(race.filter((r) => r.status === "rejected").length, 1);
          const child = (
            race.find(
              (r) => r.status === "fulfilled",
            ) as PromiseFulfilledResult<any>
          ).value.ticket;
          assert.equal(child.binding.mailboxEmail, input.email);
          assert.equal(child.provider, "composio");
          assert.equal(
            await f.scalar(
              "select simple_mail_fallback_validate($1,$2,true) v",
              [child.id, childProof],
            ),
            false,
          );
          const admission = await f.scalar<string>(
            "select admit_brand_dispatch($1,$2) v",
            [msg.id, msg.brand_claim_token],
          );
          assert.ok(admission);
          assert.equal(
            await f.scalar(
              "select simple_mail_fallback_validate($1,$2,true) v",
              [child.id, childProof],
            ),
            true,
          );
          await f.scalar("select mail_transport_finish($1,$2,'uncertain') v", [
            child.id,
            childProof,
          ]);
          await assert.rejects(
            f.scalar("select simple_mail_fallback_begin($1,$2,$3) v", [
              parent.id,
              proof,
              digest(randomUUID()),
            ]),
            /SIMPLE_NOT_READY|SIMPLE_CONFLICT/,
          );
          assert.equal(
            await f.scalar("select mail_transport_settle_dispatch($1,$2) v", [
              child.id,
              childProof,
            ]),
            "uncertain",
          );
        },
      );
      await t.test(
        "private ledgers are inaccessible to authenticated/anon/service tables",
        async () => {
          await f.owner();
          assert.equal(
            await f.scalar(
              "select bool_and(relrowsecurity) v from pg_class where relnamespace='simple_mail'::regnamespace and relkind='r'",
            ),
            true,
          );
          for (const role of ["anon", "authenticated", "service_role"])
            assert.equal(
              await f.scalar(
                "select has_table_privilege($1,'simple_mail.onboarding','SELECT') v",
                [role],
              ),
              false,
            );
        },
      );
      await t.test(
        "Composio-first new mailbox can confirm brand and register its observed identity automatically",
        async () => {
          const email = "composio.first@example.test",
            key = randomUUID();
          await f.human();
          const r = await f.scalar<any>(
            "select simple_mail_begin($1,$2,'fake-state','fixture','example.test') v",
            [
              {
                ...input,
                email,
                provider: "composio",
                idempotency_key: randomUUID(),
              },
              digest(randomUUID()),
            ],
          );
          const begun = await (
            await f.begin({
              mode: "new",
              email,
              organization: "fixture",
              brand_id: brand.id,
              expected_brand_revision: 1,
              expected_account_revision: 0,
              expected_head_revision: 0,
              expected_config_generation: 3,
              idempotency_key: key,
            })
          ).json();
          assert.ok(begun.status, begun.error);
          let v = begun.status;
          await f.human();
          await f.scalar("select simple_mail_update($1,$2,null) v", [
            r.id,
            v.id,
          ]);
          const started = await (
            await f.action(v.id, "start", {
              expected_revision: v.revision,
              idempotency_key: randomUUID(),
            })
          ).json();
          assert.ok(started.status, started.error);
          await f.owner();
          const source = await f.scalar<any>(
            "select to_jsonb(a) v from composio_connect.attempts a where id=$1",
            [v.id],
          );
          const callback = new URL(
            "/api/mail/composio/connect/callback",
            f.config.descriptor.callback_origin,
          );
          callback.searchParams.set(
            "state",
            f.config.material(f.session, key).state,
          );
          callback.searchParams.set("status", "success");
          callback.searchParams.set(
            "connected_account_id",
            source.connection_id,
          );
          assert.equal((await f.callback(callback.href)).status, 303);
          let current = await (await f.status(v.id)).json();
          assert.ok(current.status, current.error);
          await f.human();
          const confirmed = await f.scalar<any>(
            "select simple_mail_confirm($1) v",
            [r.id],
          );
          assert.ok(confirmed.account_id);
          if (current.pending)
            current = await (
              await f.action(v.id, "adopt", { idempotency_key: randomUUID() })
            ).json();
          if (current.status?.state === "ready_to_register")
            current = await (
              await f.action(v.id, "register", {
                expected_revision: current.status.revision,
                idempotency_key: randomUUID(),
              })
            ).json();
          assert.equal(current.status?.state, "completed", current.error);
          await f.human();
          const options = await f.scalar<any>("select simple_mail_options() v");
          assert.ok(!options.direct_account_ids.includes(confirmed.account_id));
          await f.owner();
          assert.equal(
            await f.scalar(
              "select live_enabled or sync_enabled v from mail_accounts where id=$1",
              [confirmed.account_id],
            ),
            false,
          );
        },
      );
      await t.test(
        "ten independent mailboxes remain scoped and create no campaigns or outgoing mail",
        async () => {
          const accounts = new Set([record.account_id]);
          await f.owner();
          const outgoingBefore = await f.scalar(
            "select count(*)::int v from outbox where account_id=$1",
            [record.account_id],
          );
          for (let n = 2; n <= 10; n++) {
            const email = `simple.${n}@example.test`;
            await f.human();
            const r = await f.scalar<any>(
              "select simple_mail_begin($1,$2,'fake-state','fixture','example.test') v",
              [
                { ...input, email, idempotency_key: randomUUID() },
                digest(randomUUID()),
              ],
            );
            await f.scalar("select simple_mail_exchange_begin($1) v", [r.id]);
            await f.service();
            await f.scalar(
              "select simple_mail_direct_saved($1,$2,$3,'fake-encrypted-token') v",
              [r.id, f.users.admin, email],
            );
            await f.human();
            await f.scalar("select simple_mail_confirm($1) v", [r.id]);
            const ready = await f.scalar<any>(
              "select simple_mail_finalize($1) v",
              [r.id],
            );
            accounts.add(ready.account_id);
            assert.equal(ready.state, "ready");
          }
          assert.equal(accounts.size, 10);
          await f.owner();
          assert.equal(
            await f.scalar(
              "select count(*)::int v from outbox where account_id=any($1::uuid[])",
              [[...accounts]],
            ),
            outgoingBefore,
          );
          assert.equal(
            await f.scalar(
              "select count(*)::int v from mail_permissions where account_id=any($1::uuid[]) and user_id=$2",
              [[...accounts], f.users.outsider],
            ),
            0,
          );
          const previous = f.sessions.get(f.users.admin)!;
          const next = randomUUID();
          await f.db.query(
            "insert into auth.sessions(id,user_id) values($1,$2)",
            [next, f.users.admin],
          );
          f.sessions.set(f.users.admin, next);
          try {
            await f.human();
            const options = await f.scalar<any>(
              "select simple_mail_options() v",
            );
            assert.equal(
              options.connections.filter(
                (r: any) =>
                  r.provider === "gmail_oauth" && accounts.has(r.account_id),
              ).length,
              10,
            );
          } finally {
            f.sessions.set(f.users.admin, previous);
            await f.human();
          }
        },
      );
      await t.test(
        "initial page cursor is durable and CAS guarded; completion requires actual runtime read receipts",
        async () => {
          await f.service();
          const proof = randomUUID();
          const revision = await f.scalar<any>(
            "select mail_transport_snapshot($1) v",
            [record.account_id],
          );
          const cycle = await f.scalar<any>(
            "select mail_sync_begin($1,$2,$3) v",
            [record.account_id, revision.revision, digest(proof)],
          );
          const start = await f.scalar<any>(
            "select simple_mail_initial_begin($1,$2,'101') v",
            [cycle.id, proof],
          );
          assert.equal(start.page, null);
          await f.scalar(
            "select simple_mail_initial_advance($1,$2,null,'page-two') v",
            [cycle.id, proof],
          );
          await assert.rejects(
            f.scalar(
              "select simple_mail_initial_advance($1,$2,null,'other-page') v",
              [cycle.id, proof],
            ),
            /SIMPLE_CONFLICT/,
          );
          await assert.rejects(
            f.scalar(
              "select simple_mail_initial_advance($1,$2,'page-two',null) v",
              [cycle.id, proof],
            ),
            /R06_UNRESOLVED/,
          );
          const resumed = await f.scalar<any>(
            "select simple_mail_initial_begin($1,$2,'999') v",
            [cycle.id, proof],
          );
          assert.equal(resumed.page, "page-two");
          assert.equal(resumed.baseline, "101");
          assert.equal(resumed.done, false);
          const readProof = digest(randomUUID());
          const ticket = await f.scalar<any>(
            "select mail_sync_acquire($1,$2,'profile','profile',$3) v",
            [cycle.id, proof, digest(readProof)],
          );
          assert.equal(
            await f.scalar(
              "select mail_transport_validate_context($1,$2,null,0,true) v",
              [ticket.id, readProof],
            ),
            true,
          );
          await f.scalar("select mail_transport_finish($1,$2,'finished') v", [
            ticket.id,
            readProof,
          ]);
          await f.scalar(
            "select simple_mail_initial_advance($1,$2,'page-two',null) v",
            [cycle.id, proof],
          );
          await f.owner();
          assert.equal(
            await f.scalar(
              "select history_id v from gmail_sync_state where account_id=$1",
              [record.account_id],
            ),
            "101",
          );
          assert.equal(
            await f.scalar(
              "select done v from simple_mail.sync_initial where account_id=$1",
              [record.account_id],
            ),
            true,
          );
        },
      );
      await t.test(
        "expired read-cycle recovery preserves request and outgoing uncertainty evidence",
        async () => {
          await f.service();
          const proof = digest(randomUUID());
          const route = await f.scalar<any>(
            "select mail_transport_snapshot($1) v",
            [record.account_id],
          );
          const cycle = await f.scalar<any>(
            "select mail_sync_begin($1,$2,$3) v",
            [record.account_id, route.revision, digest(proof)],
          );
          const ticket = await f.scalar<any>(
            "select mail_sync_acquire($1,$2,'profile','profile',$3) v",
            [cycle.id, proof, digest(randomUUID())],
          );
          await f.owner();
          const pending = await f.scalar(
            "select count(*)::int v from outbox where account_id=$1 and status='uncertain'",
            [record.account_id],
          );
          await f.db.query(
            "update mail_runtime.sync_cycles set created_at=now()-interval '16 minutes',deadline=now()-interval '1 minute' where id=$1",
            [cycle.id],
          );
          await f.service();
          assert.equal(
            await f.scalar("select simple_mail_recover_sync($1) v", [
              record.account_id,
            ]),
            1,
          );
          await f.owner();
          assert.equal(
            await f.scalar(
              "select state v from mail_runtime.attempts where id=$1",
              [ticket.id],
            ),
            "reserved",
          );
          assert.equal(
            await f.scalar(
              "select count(*)::int v from outbox where account_id=$1 and status='uncertain'",
              [record.account_id],
            ),
            pending,
          );
        },
      );
      await t.test(
        "read status exposes sync attention without leaking errors and degrades revoked advisor permission",
        async () => {
          await f.owner();
          await f.db.query(
            "insert into gmail_sync_state(account_id,last_synced_at,last_error) values($1,now(),'fictional-private-provider-detail') on conflict(account_id) do update set last_error=excluded.last_error",
            [record.account_id],
          );
          await f.human();
          let dto = await f.scalar<any>("select simple_mail_get($1) v", [
            record.id,
          ]);
          assert.equal(dto.sync_status, "attention");
          assert.ok(dto.last_synced_at);
          assert.ok(!JSON.stringify(dto).includes("fictional-private"));
          await f.owner();
          await f.db.query(
            "update mail_permissions set can_send=false where account_id=$1 and user_id=$2",
            [record.account_id, f.users.seller],
          );
          await f.human();
          dto = await f.scalar<any>("select simple_mail_get($1) v", [
            record.id,
          ]);
          assert.equal(dto.state, "attention");
          await f.owner();
          await f.db.query(
            "update mail_permissions set can_send=true where account_id=$1 and user_id=$2",
            [record.account_id, f.users.seller],
          );
          await f.db.query(
            "update gmail_sync_state set last_error=null where account_id=$1",
            [record.account_id],
          );
        },
      );
      await t.test(
        "disconnect is local, idempotent and preserves identity/history",
        async () => {
          await f.human();
          await f.owner();
          const previous = await f.scalar<any>(
            "select to_jsonb(h) v from simple_mail.health h where onboarding_id=$1",
            [record.id],
          );
          await f.db.query(
            "update simple_mail.health set onboarding_id=$1 where account_id=$2 and provider='gmail_oauth'",
            [comp.id, record.account_id],
          );
          await f.human();
          await assert.rejects(
            f.scalar("select simple_mail_disconnect($1) v", [record.id]),
            /SIMPLE_CONFLICT/,
          );
          await f.owner();
          await f.db.query(
            "update simple_mail.health set onboarding_id=$1 where account_id=$2 and provider='gmail_oauth'",
            [previous.onboarding_id, record.account_id],
          );
          await f.human();
          assert.equal(
            (
              await f.scalar<any>("select simple_mail_disconnect($1) v", [
                record.id,
              ])
            ).state,
            "disconnected",
          );
          assert.equal(
            (
              await f.scalar<any>("select simple_mail_disconnect($1) v", [
                record.id,
              ])
            ).state,
            "disconnected",
          );
          await f.owner();
          assert.equal(
            await f.scalar(
              "select count(*)::int v from mail_accounts where id=$1",
              [record.account_id],
            ),
            1,
          );
        },
      );
    } finally {
      await f.db.close();
    }
  },
);
