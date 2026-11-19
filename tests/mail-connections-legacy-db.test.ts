import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connectV2Fixture } from "./fixtures/pipeline-os-s02-connect-v2";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  prepareLegacyMailbox,
  legacyMailboxPorts,
  type LegacyAccount,
  type LegacyReview,
  type LegacyMailboxPorts,
} from "../src/lib/server/mail-accounts/onboarding/legacy-account";

test(
  "Legacy Gmail adapter: real audited brand commands recover an existing row before OAuth",
  { timeout: 120000 },
  async (t) => {
    const f = await connectV2Fixture();
    try {
      await f.owner();
      const quota = await readFile(
        "docs/specs/pipeline-os/s02/release/quota-final/052_integrate_mail_quota_and_existing_bindings.sql",
        "utf8",
      );
      const start = quota.indexOf("create table mail_quota.binding_contexts("),
        end = quota.indexOf("\ndo $qgr$", start);
      assert(start > 0 && end > start);
      await f.db.exec(quota.slice(start, end));
      await f.db.exec(
        await readFile(
          "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/simple-mail.local.sql",
          "utf8",
        ),
      );
      await f.human();
      const brand = await f.scalar<any>(
        "select crm_command('brand_create',$1,$2) v",
        [
          {
            code: "CURATED_FINANCIAL",
            name: "Curated Financial",
            active: true,
          },
          randomUUID(),
        ],
      );
      const client = {
        rpc: async (name: string, p: Record<string, unknown>) => {
          try {
            return {
              data:
                name === "brand_management_page"
                  ? await f.scalar("select brand_management_page($1,$2,$3) v", [
                      p.collection,
                      p.cursor,
                      p.page_size,
                    ])
                  : name === "crm_command"
                    ? await f.scalar("select crm_command($1,$2,$3) v", [
                        p.kind,
                        p.p,
                        p.request_key,
                      ])
                    : null,
              error: null,
            };
          } catch (e) {
            return { data: null, error: { message: (e as Error).message } };
          }
        },
      } as unknown as SupabaseClient;
      const ports: LegacyMailboxPorts = legacyMailboxPorts(client);
      async function legacy(email: string, pending = false) {
        await f.owner();
        const row = await f.scalar<LegacyAccount>(
          "insert into mail_accounts(email,organization,status,live_enabled) values($1,'fixture','disconnected',false) returning to_jsonb(mail_accounts) v",
          [email],
        );
        await f.human();
        if (pending)
          await f.scalar(
            "select crm_command('brand_mapping_propose',$1,$2) v",
            [
              {
                account_id: row.id,
                proposed_brand_id: brand.id,
                expected_account_revision: row.brand_revision,
                evidence_reference: "legacy-existing-reviewed",
                history_approved: false,
              },
              randomUUID(),
            ],
          );
        return row;
      }
      for (const pending of [false, true])
        await t.test(
          pending ? "reuse compatible pending review" : "create missing review",
          async () => {
            const email =
                (pending ? "pending" : "unreviewed") + ".legacy@example.test",
              row = await legacy(email, pending);
            const input = {
              email,
              provider: "gmail_oauth" as const,
              advisor_id: f.users.seller,
              idempotency_key: randomUUID(),
            };
            const args = [
              input,
              createHash("sha256").update(randomUUID()).digest("hex"),
              "fixture-state",
              "fixture",
              "example.test",
            ];
            await assert.rejects(
              f.scalar("select simple_mail_begin($1,$2,$3,$4,$5) v", args),
              /BRAND_REVIEW_REQUIRED/,
            );
            await prepareLegacyMailbox(ports, input, "fixture");
            const first = await f.scalar<any>(
              "select simple_mail_begin($1,$2,$3,$4,$5) v",
              args,
            );
            assert.equal(first.account_id, row.id);
            assert.equal(first.state, "prepared");
            await prepareLegacyMailbox(ports, input, "fixture");
            assert.equal(
              (
                await f.scalar<any>(
                  "select simple_mail_begin($1,$2,$3,$4,$5) v",
                  args,
                )
              ).id,
              first.id,
            );
            const saved = await ports.account(email);
            assert.equal(saved?.brand_revision, row.brand_revision + 1);
            assert.equal(saved?.operating_brand_id, brand.id);
            assert.equal(saved?.status, "disconnected");
            await f.owner();
            assert.equal(
              await f.scalar(
                "select count(*)::int v from mail_account_brand_reviews where account_id=$1 and status='confirmed'",
                [row.id],
              ),
              1,
            );
            assert.equal(
              await f.scalar(
                "select count(*)::int v from audit_log where action='brand_mapping_confirm' and entity_id in(select id from mail_account_brand_reviews where account_id=$1)",
                [row.id],
              ),
              1,
            );
            assert.equal(
              await f.scalar(
                "select count(*)::int v from mail_credentials where account_id=$1",
                [row.id],
              ),
              0,
            );
            assert.equal(
              await f.scalar(
                "select count(*)::int v from mail_permissions where account_id=$1",
                [row.id],
              ),
              0,
            );
            assert.equal(
              await f.scalar(
                "select count(*)::int v from outbox where account_id=$1",
                [row.id],
              ),
              0,
            );
            await f.human();
          },
        );
      await t.test(
        "seller cannot confirm even with a previously read account snapshot",
        async () => {
          const row = await legacy("denied.legacy@example.test");
          const before = await ports.account("denied.legacy@example.test");
          await f.human(f.users.seller);
          await assert.rejects(
            prepareLegacyMailbox(
              {
                ...ports,
                account: async () => before,
                brand: async () => ({ id: brand.id }),
                review: async () => null,
              },
              {
                email: "denied.legacy@example.test",
                provider: "gmail_oauth",
                idempotency_key: randomUUID(),
              },
              "fixture",
            ),
            /SIMPLE_FORBIDDEN/,
          );
          await f.owner();
          assert.equal(
            await f.scalar(
              "select operating_brand_id v from mail_accounts where id=$1",
              [row.id],
            ),
            null,
          );
        },
      );
      await t.test(
        "MFA remains mandatory for automatic legacy confirmation",
        async () => {
          const row = await legacy("mfa.legacy@example.test", true);
          await f.human(f.users.admin, "aal1");
          await assert.rejects(
            prepareLegacyMailbox(
              ports,
              {
                email: "mfa.legacy@example.test",
                provider: "gmail_oauth",
                idempotency_key: randomUUID(),
              },
              "fixture",
            ),
            /SIMPLE_FORBIDDEN/,
          );
          await f.owner();
          assert.equal(
            await f.scalar(
              "select operating_brand_id v from mail_accounts where id=$1",
              [row.id],
            ),
            null,
          );
        },
      );
    } finally {
      await f.db.close();
    }
  },
);
