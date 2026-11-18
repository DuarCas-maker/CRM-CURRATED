import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { controlFixture } from "./campaign-control";
import { featureDatabase } from "../feature-database";
import { installBrandDelivery } from "./pipeline-os-s02-brand-delivery";
import { defaultReminders } from "../../src/lib/campaign-flow";
export const flowRoot =
  "docs/specs/pipeline-os/campaign-flow-20261117/migrations/";
export async function flowFixture(
  factory: typeof featureDatabase = featureDatabase,
) {
  const f = await controlFixture(async () => {
    const base = await factory({ beforeMigration: "055" });
    await installBrandDelivery(base);
    for (const file of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql") && f >= "055")
      .sort())
      await base.db.exec(await readFile("supabase/migrations/" + file, "utf8"));
    return base;
  });
  await f.db.exec("reset role");
  await f.db.exec(await readFile(flowRoot + "up.sql", "utf8"));
  await f.asUser(f.users.admin);
  const p = {
    account_id: f.accounts[0],
    brand_preparation: f.prep,
    template_id: f.template,
    template_version: 1,
    contact_ids: f.contacts,
    scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    timezone: "America/Bogota",
    reminders: defaultReminders,
  };
  const launch = async (payload = p, key = randomUUID()) =>
    (
      await f.db.query<any>("select campaign_flow_launch($1,$2) r", [
        payload,
        key,
      ])
    ).rows[0].r;
  return { ...f, p, launch };
}
