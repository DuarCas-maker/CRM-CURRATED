import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "../feature-database";
export type BrandDatabase = Awaited<ReturnType<typeof featureDatabase>>;
export async function installBrandDelivery(
  f: BrandDatabase,
  includeDelivery = true,
) {
  const { db } = f;
  await db.exec(
    "reset role;set pipeline_os.block_a_local='in_memory_test';set pipeline_os.block_b1_local='in_memory_test';set pipeline_os.block_b2_local='in_memory_test'",
  );
  const has = async (name: string) =>
    (
      await db.query<{ present: boolean }>(
        "select to_regnamespace($1) is not null present",
        [name],
      )
    ).rows[0].present;
  const run = async (p: string) =>
    db.exec(
      await readFile("docs/specs/pipeline-os/s02/integration/" + p, "utf8"),
    );
  if (
    !(
      await db.query<{ present: boolean }>(
        "select to_regclass('public.operating_brands') is not null present",
      )
    ).rows[0].present
  )
    await run("migrations/a-brand-foundation.local.sql");
  if (!(await has("s01_i02")))
    await run("migrations/a-mail-permissions.local.sql");
  if (!(await has("brand_b1")))
    await run("block-b/migrations/b-brand-management.local.sql");
  if (includeDelivery && !(await has("brand_b2")))
    await run("block-b/migrations/b-brand-delivery.local.sql");
}
export async function bindFixtureAccount(
  f: BrandDatabase,
  account: string,
  actor = f.users.seller,
) {
  await f.asUser(f.users.admin);
  const brand = (
    await f.command("brand_create", {
      code: "B_" + randomUUID().slice(0, 8),
      name: "Fixture brand",
      active: true,
    })
  ).id;
  const review = (
    await f.command("brand_mapping_propose", {
      account_id: account,
      proposed_brand_id: brand,
      expected_account_revision: 0,
      evidence_reference: "fixture-reviewed",
    })
  ).id;
  await f.command("brand_mapping_confirm", {
    review_id: review,
    expected_review_revision: 1,
    expected_account_revision: 0,
    acknowledge_conflict: true,
  });
  await f.command("brand_membership_set", {
    brand_id: brand,
    user_id: actor,
    active: true,
    expected_revision: 0,
  });
  await f.db.exec("reset role");
  await f.db.query(
    "insert into mail_permissions(account_id,user_id,can_send) values($1,$2,true) on conflict(account_id,user_id) do update set can_send=true",
    [account, actor],
  );
  return { brand_id: brand, brand_revision: 1, account_revision: 1 };
}
export async function queueFixtureMail(
  f: BrandDatabase,
  account: string,
  actor: string,
  caseId: string,
  preparation: object,
  extra: Record<string, unknown> = {},
) {
  await f.asUser(actor);
  const value = (
    await f.db.query<{ id: string }>(
      "select brand_queue_mail('queue_mail_email',$1,$2) #>> '{}' id",
      [
        {
          case_id: caseId,
          account,
          recipient: "client@fixture.test",
          subject_text: "Fixture",
          body_text: "Body",
          files: [],
          gmail_files: [],
          uploads: [],
          copies: [],
          hidden_copies: [],
          process: null,
          conversation: null,
          reply_message: null,
          submission: null,
          signature: "",
          display_name: "",
          request: randomUUID(),
          ...extra,
        },
        preparation,
      ],
    )
  ).rows[0].id;
  await f.db.exec("reset role");
  return value;
}
export function fakeBrandEnvelope(account: string) {
  return {
    brand_claim_token: randomUUID(),
    brand_snapshot: {
      version: 1,
      brand_id: randomUUID(),
      brand_code: "FIXTURE",
      brand_name: "Fixture brand",
      brand_revision: 1,
      account_id: account,
      account_revision: 1,
      actor_id: randomUUID(),
      purpose: "mail",
      authorization: "human_aal2",
      prepared_at: "2026-10-31T00:00:00Z",
    },
  };
}
export { featureDatabase };
