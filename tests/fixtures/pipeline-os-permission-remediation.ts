import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { featureDatabase } from "../feature-database";
import {
  loadPermissionTargets,
  parseViewReview,
  remediationRoot,
  renderPermissionCorrection,
  renderViewReview,
  reviewScopeDigest,
} from "../../scripts/pipeline-os/permission-remediation";

export async function remediationFixture() {
  const f = await featureDatabase();
  try {
    const targets = await loadPermissionTargets(),
      correction = await renderPermissionCorrection(),
      review = await renderViewReview(),
      digest = await reviewScopeDigest();
    await f.db.exec(
      "create role supabase_admin superuser;grant supabase_admin to postgres;",
    );
    for (const t of targets)
      await f.db.exec(
        `alter ${t.kind === "v" ? "view" : "table"} ${t.key} owner to supabase_admin`,
      );
    // Reproduce observed broad table ACL and creator defaults without replacing
    // platform schemas, business policies, functions or accepted product tests.
    const broaden = async () => {
      await f.db.exec("reset role;set role supabase_admin;");
      for (const t of targets)
        await f.db.exec(
          `grant all on table ${t.key} to anon,authenticated,service_role,postgres`,
        );
    };
    await broaden();
    const inventory = JSON.parse(
      await readFile(remediationRoot + "function-inventory.json", "utf8"),
    );
    const serviceFunctions: string[] = inventory.functions.map(
      (f: { key: string }) => f.key,
    );
    for (const signature of serviceFunctions)
      await f.db.exec(`grant execute on function ${signature} to service_role`);
    await f.db
      .exec(`alter default privileges for role supabase_admin in schema public grant all on tables to anon,authenticated,service_role,postgres;
      alter default privileges for role supabase_admin in schema public grant execute on functions to anon,authenticated,service_role,postgres;
      alter default privileges for role supabase_admin in schema public grant all on sequences to anon,authenticated,service_role,postgres;
      reset role`);
    const contact = randomUUID(),
      opportunity = randomUUID(),
      account = randomUUID();
    await f.db.query(
      "insert into contacts(id,name,email,verification) values($1,'Fixture','prm-client@example.test','valid')",
      [contact],
    );
    await f.db.query(
      "insert into opportunities(id,contact_id,company,seller_id) values($1,$2,'PRM fixture',$3)",
      [opportunity, contact, f.users.seller],
    );
    await f.db.query(
      "insert into mail_accounts(id,email,organization) values($1,'prm-mail@example.test','fixture')",
      [account],
    );
    await f.db.query(
      "insert into conversations(opportunity_id,account_id,gmail_thread_id,subject,area,inbox_activated_at) values($1,$2,'prm-fictional-thread','Fixture','seller',now())",
      [opportunity, account],
    );
    await f.db.query(
      "insert into tasks(opportunity_id,owner_id,title,due_at,area) values($1,$2,'Fixture',now(),'seller')",
      [opportunity, f.users.seller],
    );
    const admin = async () => {
      await f.db.exec("reset role;set role supabase_admin");
    };
    const apply = async (sql = correction) => {
      await admin();
      await f.db.exec("set pipeline_os.prm1_mode='offline_fixture_only'");
      try {
        await f.db.exec(sql);
      } catch (e) {
        await f.db.exec("rollback");
        throw e;
      }
    };
    const snapshot = async () => {
      await admin();
      try {
        const result = await f.db.exec(review);
        return parseViewReview(
          result
            .flatMap((r) => r.rows)
            .find((r: any) => r.pipeline_os_abc_view_review)
            ?.pipeline_os_abc_view_review,
          digest,
        );
      } catch (e) {
        await f.db.exec("rollback");
        throw e;
      }
    };
    const protectedSnapshot = async () => {
      await admin();
      const data = [];
      const tables = (
        await f.db.query<{ name: string }>(
          "select c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname",
        )
      ).rows;
      for (const { name } of tables)
        data.push({
          name,
          hash: (
            await f.db.query<{ hash: string }>(
              `select md5(coalesce(string_agg(r::text,'|' order by r::text),'')) hash from public."${name.replaceAll('"', '""')}" r`,
            )
          ).rows[0].hash,
        });
      const metadata = (
        await f.db.query(`select jsonb_build_object(
        'functions',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','storage')),
        'defaults',(select md5(string_agg(d::text,'|' order by d.oid)) from pg_default_acl d),
        'policies',(select md5(string_agg(p::text,'|' order by p.oid)) from pg_policy p),
        'storage',(select md5(string_agg(c::text,'|' order by c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage'),
        'rows',(select md5(jsonb_build_object('profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
          'selections',(select jsonb_agg(to_jsonb(p) order by p.id) from public.mail_recipient_selections p),
          'outbox',(select jsonb_agg(to_jsonb(p) order by p.id) from public.outbox p),
          'jobs',(select jsonb_agg(to_jsonb(p) order by p.id) from public.jobs p))::text))
      ) protected`)
      ).rows;
      return { metadata, data };
    };
    const definitions = async () => {
      await admin();
      await f.db.exec(
        "begin read only;set local search_path=pg_catalog, pg_temp",
      );
      try {
        return (
          await f.db.query<{ key: string; definition: string }>(
            "select n.nspname||'.'||c.relname key,pg_get_viewdef(c.oid,false) definition from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('campaign_workspace','opportunity_inbox','opportunity_tasks') order by 1",
          )
        ).rows;
      } finally {
        await f.db.exec("rollback");
      }
    };
    return {
      ...f,
      opportunity,
      serviceFunctions,
      targets,
      correction,
      review,
      digest,
      apply,
      snapshot,
      protectedSnapshot,
      definitions,
      admin,
      broaden,
      fixedCorrection: () =>
        readFile(remediationRoot + "permission-correction.local.sql", "utf8"),
    };
  } catch (e) {
    await f.db.close();
    throw e;
  }
}
