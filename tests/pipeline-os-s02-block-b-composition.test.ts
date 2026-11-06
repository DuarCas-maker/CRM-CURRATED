import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  accountPreparation,
  snapshotPreparation,
  sameBrandPreparation,
  brandPreparationSchema,
} from "../src/lib/brand-delivery";
import { demoWorkspace } from "../src/lib/demo";
import * as google from "../src/lib/server/google";
import { fakeBrandEnvelope } from "./fixtures/pipeline-os-s02-brand-delivery";
import type { SupabaseClient } from "@supabase/supabase-js";

test("B2 DTO: sender selection preserves exact revisions and never infers an unconfirmed brand", () => {
  assert.equal(accountPreparation(undefined), null);
  assert.equal(snapshotPreparation(null), null);
  assert.equal(
    brandPreparationSchema.safeParse({
      brand_id: randomUUID(),
      brand_revision: 1,
      account_revision: 1,
      actor_id: randomUUID(),
    }).success,
    false,
  );
  const a = randomUUID(),
    e = fakeBrandEnvelope(a),
    p = {
      brand_id: e.brand_snapshot.brand_id,
      brand_revision: 1,
      account_revision: 1,
    };
  assert.deepEqual(snapshotPreparation(e.brand_snapshot), p);
  assert.ok(
    sameBrandPreparation(p, {
      account_revision: 1,
      brand_id: p.brand_id,
      brand_revision: 1,
    }),
  );
  assert.equal(sameBrandPreparation(p, { ...p, account_revision: 2 }), false);
});
test("B2 UI: mail and campaigns show reviewed brand and keep old/unreviewed sends disabled, ES/EN", async () => {
  const { MailEditor } = await import("../src/components/mail-editor");
  const { CampaignComposer } =
    await import("../src/components/campaign-composer");
  const { CampaignReview } = await import("../src/components/campaign-review");
  const data = demoWorkspace();
  data.accounts[0].brand_context = {
    account_id: data.accounts[0].id,
    brand_id: randomUUID(),
    brand_name: "Fixture brand",
    brand_code: "FIXTURE",
    brand_revision: 1,
    account_revision: 1,
    can_campaign: true,
  };
  data.sender_account_ids = [data.accounts[0].id];
  for (const locale of ["es", "en"] as const) {
    const mail = renderToStaticMarkup(
      h(MailEditor, {
        data,
        locale,
        act: async () => null,
        busy: false,
        close: () => {},
        opportunity: data.opportunities[0],
      }),
    );
    assert.match(
      mail,
      locale === "es" ? /Marca revisada/ : /Reviewed sender brand/,
    );
    assert.match(mail, /<option value="" selected="">/);
    const campaign = renderToStaticMarkup(
      h(CampaignComposer, {
        data,
        locale,
        initialTemplate: data.email_templates?.[0] || null,
        act: async () => null,
        close: () => {},
      }),
    );
    assert.match(
      campaign,
      locale === "es" ? /Marca de la campaña/ : /Campaign brand/,
    );
    const reply = renderToStaticMarkup(
      h(MailEditor, {
        data: { ...data, gmail_history_enabled: false },
        locale,
        act: async () => null,
        busy: false,
        close: () => {},
        opportunity: data.opportunities[0],
        start: { mode: "reply", account_id: data.accounts[0].id },
      }),
    );
    assert.match(
      reply,
      locale === "es" ? /Marca revisada/ : /Reviewed sender brand/,
    );
    if (data.campaigns[0]) {
      const review = renderToStaticMarkup(
        h(CampaignReview, {
          data,
          locale,
          campaign: data.campaigns[0],
          act: async () => null,
          close: () => {},
        }),
      );
      assert.match(
        review,
        locale === "es" ? /Pendiente de revisión/ : /Awaiting review/,
      );
    }
  }
});
if (!process.execArgv.includes("--experimental-test-module-mocks"))
  test("B2 facade checks in isolated module mocks", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--test",
        "--test-name-pattern=B2 server",
        "tests/pipeline-os-s02-block-b-composition.test.ts",
      ],
      { env, encoding: "utf8", timeout: 45000 },
    );
    assert.match(output, /# fail 0/);
  });
else
  test("B2 server: missing/stale preparation stops before signature; valid send revalidates and delegates atomically", async (t) => {
    const account = randomUUID(),
      caseId = randomUUID(),
      envelope = fakeBrandEnvelope(account);
    let signatures = 0,
      queued = 0,
      preflights = 0,
      mode = "valid";
    const p = {
      brand_id: envelope.brand_snapshot.brand_id,
      brand_revision: 1,
      account_revision: 1,
    };
    const module = mock.module("../src/lib/server/google.ts", {
      namedExports: {
        ...google,
        gmail: async (
          _a: string,
          path: string,
          _init: unknown,
          before?: () => Promise<void>,
        ) => {
          assert.ok(path.startsWith("settings/sendAs/"));
          await before?.();
          signatures++;
          return { signature: "<b>Fixture</b>", displayName: "Fixture" };
        },
      },
    });
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "can_mail_case" || name === "can_send")
          return { data: true, error: null };
        if (name === "mail_access_context")
          return { data: { area: "seller", can_write: true }, error: null };
        if (name === "brand_prepare_context") {
          preflights++;
          return mode === "valid"
            ? { data: envelope.brand_snapshot, error: null }
            : mode === "missing"
              ? {
                  data: null,
                  error: {
                    code: "42883",
                    message: "private SQL schema detail",
                  },
                }
              : {
                  data: null,
                  error: { code: "P0001", message: "BRAND_PREPARATION_STALE" },
                };
        }
        if (name === "brand_queue_mail") {
          queued++;
          assert.deepEqual(args.preparation, p);
          return { data: randomUUID(), error: null };
        }
        throw Error("Unexpected fake RPC " + name);
      },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              assert.equal(table, "mail_accounts");
              return {
                data: { email: "fixture@sender.test", status: "connected" },
                error: null,
              };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    try {
      const { sendManagedMail } =
        await import("../src/lib/server/mail-manager");
      const profile = {
        id: randomUUID(),
        role: "seller",
        email: "seller@fixture.test",
        name: "Fixture",
        active: true,
      } as const;
      const payload = {
        account_id: account,
        opportunity_id: caseId,
        to_email: "lead@fixture.test",
        subject: "Fixture",
        body: "Body",
      };
      await t.test("no preparation", async () => {
        await assert.rejects(
          sendManagedMail(db, profile, payload, randomUUID()),
          /Revisa y confirma/,
        );
        assert.equal(signatures, 0);
        assert.equal(queued, 0);
      });
      for (const failure of ["missing", "stale"])
        await t.test(failure, async () => {
          mode = failure;
          await assert.rejects(
            sendManagedMail(
              db,
              profile,
              { ...payload, brand_preparation: p },
              randomUUID(),
            ),
          );
          assert.equal(signatures, 0);
          assert.equal(queued, 0);
        });
      await t.test("authorized", async () => {
        mode = "valid";
        await sendManagedMail(
          db,
          profile,
          { ...payload, brand_preparation: p },
          randomUUID(),
        );
        assert.equal(signatures, 1);
        assert.equal(queued, 1);
        assert.ok(preflights >= 4);
      });
    } finally {
      module.restore();
    }
  });
