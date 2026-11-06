import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  featureDatabase,
  installBrandDelivery,
  bindFixtureAccount,
  queueFixtureMail,
} from "./pipeline-os-s02-brand-delivery";
import {
  bindingExpected,
  type BindingPage,
} from "../../src/lib/composio-bindings";

export const c1Candidate = {
  composio_project_id: "pr_C1_private_project",
  auth_config_id: "ac_C1_private_config",
  connected_account_id: "ca_C1_private_connection",
  composio_user_id: "C1_private_owner",
  google_quota_project_id: "google-private-quota",
};
export const c1Sql =
  "docs/specs/pipeline-os/s02/integration/block-c/migrations/c-composio-bindings.local.sql";
export async function c1Fixture(install = true) {
  const f = await featureDatabase();
  const { db, users } = f;
  try {
    await installBrandDelivery(f);
    const accounts = [randomUUID(), randomUUID(), randomUUID()];
    await db.query(
      "insert into mail_accounts(id,email,organization) values($1,'one@c1.test','fixture'),($2,'two@c1.test','fixture'),($3,'unreviewed@c1.test','fixture')",
      accounts,
    );
    const brandA = await bindFixtureAccount(f, accounts[0]);
    const brandB = await bindFixtureAccount(f, accounts[1], users.outsider);
    await db.exec("reset role");
    const contact = randomUUID(),
      opportunity = randomUUID();
    await db.query(
      "insert into contacts(id,name,email,verification) values($1,'Fixture','client@c1.test','valid')",
      [contact],
    );
    await db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'Fixture',$3)",
      [opportunity, contact, users.seller],
    );
    const queued = await queueFixtureMail(
      f,
      accounts[0],
      users.seller,
      opportunity,
      brandA,
    );
    await db.query(
      "insert into mail_credentials(account_id,encrypted_refresh_token) values($1,'fictional-encrypted-token')",
      [accounts[0]],
    );
    const sellerAdmin = randomUUID(),
      closerAdmin = randomUUID();
    for (const [id, role] of [
      [sellerAdmin, "seller_admin"],
      [closerAdmin, "closer_admin"],
    ]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        role + "@c1.test",
      ]);
      await db.query(
        "insert into profiles(id,email,name,role) values($1,$2,'Fixture',$3)",
        [id, role + "@c1.test", role],
      );
    }
    if (install) {
      await db.exec("set pipeline_os.block_c_local='in_memory_test'");
      await db.exec(await readFile(c1Sql, "utf8"));
    }
    const page = async (
      account = accounts[0],
      cursor: string | null = null,
      limit = 25,
    ) =>
      (
        await db.query<{ v: BindingPage }>(
          "select composio_binding_page($1,$2,$3) v",
          [account, cursor, limit],
        )
      ).rows[0].v;
    const commandC = async (
      kind: string,
      p: object,
      account = accounts[0],
      key = randomUUID(),
    ) =>
      (
        await db.query<{
          v: { id: string; head_revision: number; status: string };
        }>("select composio_binding_command($1,$2,$3,$4) v", [
          account,
          kind,
          p,
          key,
        ])
      ).rows[0].v;
    const register = async (
      extra: object = {},
      account = accounts[0],
      key = randomUUID(),
    ) =>
      commandC(
        "register_candidate",
        { ...bindingExpected(await page(account)), ...c1Candidate, ...extra },
        account,
        key,
      );
    return {
      ...f,
      accounts,
      brandA,
      brandB,
      opportunity,
      queued,
      roles: [users.seller, sellerAdmin, users.closer, closerAdmin],
      page,
      commandC,
      register,
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}
