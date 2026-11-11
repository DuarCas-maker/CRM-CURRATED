// Local release artifact composer; no env loader, network or production client.
import fs from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  runtimeCatalog,
  runtimeDiff,
} from "../../../../../../scripts/pipeline-os/mail-runtime-release.ts";
export const root = "docs/specs/pipeline-os/s02/release/quota-final/";
const read = (p) => fs.readFileSync(p, "utf8").replaceAll("\r\n", "\n");
export const hash = (b) => createHash("sha256").update(b).digest("hex");
const lit = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const qgr = "docs/specs/pipeline-os/s02/quota-policy-reuse/";
export const sourcePaths = [
  "quota-policy-v2.local.sql",
  "quota-i03.local.sql",
  "quota-i04.local.sql",
].map((n) => qgr + "migrations/" + n);
export const catalog = runtimeCatalog
  .replace(
    "'composio_connect_runtime'))",
    "'composio_connect_runtime','mail_quota'))",
  )
  .replace(
    /'sourceHash',md5\(.*?\),'execute'/,
    "'sourceHash',md5(regexp_replace(p.prosrc,chr(13)||chr(10)||'?',chr(10),'g')),'execute'",
  )
  .replaceAll(
    "order by x.grantee,x.privilege_type",
    "order by case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end collate \"C\",x.privilege_type",
  );
assert.ok(catalog.includes("'mail_quota'"));
assert.ok(catalog.includes("regexp_replace(p.prosrc"));
export function ddl() {
  return sourcePaths
    .map((p, i) => {
      let s = read(p);
      const rx =
        i < 2
          ? / if current_setting\('pipeline_os\.qgr_local'[\s\S]*?then raise exception 'QGR_LOCAL_ONLY';end if;/g
          : / if current_setting\('pipeline_os\.qgr_i04_local'[\s\S]*?then raise exception 'QGR_I04_LOCAL_ONLY';end if;/g;
      assert.equal([...s.matchAll(rx)].length, i === 2 ? 3 : 1, p);
      s = s.replace(rx, " -- Local-host guard replaced by QGR-FINAL guards.");
      assert.equal((s.match(/^begin;$/gm) || []).length, 1);
      assert.equal((s.match(/^commit;$/gm) || []).length, 1);
      s = s.replace(/^begin;\n/m, "").replace(/^commit;\s*$/m, "");
      assert.ok(!s.includes("current_setting('pipeline_os.qgr"));
      return (
        "\n-- Sealed source " +
        p +
        " SHA256 " +
        hash(fs.readFileSync(p)) +
        "\n" +
        s
      );
    })
    .join("\n");
}
const context = `current_user='supabase_admin' and (select rolsuper from pg_roles where rolname=current_user)
 and current_setting('server_version_num')::int between 150000 and 159999
 and (select count(*)=2 and bool_and(rolinherit and not rolsuper and not rolbypassrls) from pg_roles where rolname in('anon','authenticated'))
 and exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper)
 and not exists(select 1 from pg_roles r cross join (values('anon'),('authenticated'),('service_role')) h(name) where r.rolname<>h.name and pg_has_role(h.name,r.oid,'MEMBER'))
 and not exists(select 1 from (values('anon'),('authenticated'),('service_role')) h(name) where not has_schema_privilege(h.name,'public','USAGE') or has_schema_privilege(h.name,'public','CREATE'))
 and (select count(*)=5 from pg_attribute where attrelid=to_regclass('auth.sessions') and attnum>0 and not attisdropped and
 ((attname in('id','user_id') and atttypid='uuid'::regtype) or(attname in('created_at','not_after') and atttypid='timestamptz'::regtype) or(attname='refreshed_at' and atttypid in('timestamp'::regtype,'timestamptz'::regtype))))`;
const queue = `select jsonb_build_object('queued',(select count(*) from public.outbox where status='queued'),'sending',(select count(*) from public.outbox where status='sending'),'uncertain',(select count(*) from public.outbox where status='uncertain'),
 'jobs',(select count(*) from public.jobs where status='running'),'campaigns',(select count(*) from public.campaigns where status='active'),'enrollments',(select count(*) from public.campaign_enrollments where status='active'),
 'attempts',(select count(*) from mail_runtime.attempts where state in('reserved','admitted','uncertain')),'cycles',(select count(*) from mail_runtime.sync_cycles where state in('active','uncertain')),
 'draining',(select count(*) from mail_runtime.routes where state='draining'),'brandAdmissions',(select count(*) from public.mail_brand_dispatch_admissions where outcome in('admitted','uncertain'))) into queue_state;
 queue_ok:=not exists(select 1 from jsonb_each_text(queue_state) x where x.value::bigint<>0);`;
const capture = `select snapshot into observed from (${catalog}) catalog;`;
const compare = `mismatches:='[]'::jsonb;for g in select jsonb_object_keys(expected) loop for k,v in select * from jsonb_each(expected->g) loop
 a:=coalesce(observed->g->k,'null'::jsonb);if a is distinct from v then
  mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group',g,'object',k,'fields',case when jsonb_typeof(v)='object' and jsonb_typeof(a)='object' then (select jsonb_agg(field order by field collate "C") from (select jsonb_object_keys(v) field union select jsonb_object_keys(a) field) f where v->field is distinct from a->field) else jsonb_build_array('presence') end));
 end if;end loop;end loop;`;
const preserved = (name) =>
  `select jsonb_object_agg(e.key,(select coalesce(jsonb_object_agg(x.key,x.value),'{}') from jsonb_each(e.value) x where not(d->'post'->e.key ? x.key))) into ${name} from jsonb_each(observed) e;`;
const dataTables = [
  "public.mail_accounts",
  "public.mail_credentials",
  "public.mail_permissions",
  "public.mail_provider_bindings",
  "public.mail_provider_binding_heads",
  "public.mail_provider_binding_checks",
  "public.mail_account_brand_reviews",
  "public.operating_brands",
  "public.profiles",
  "public.outbox",
  "public.jobs",
  "public.campaigns",
  "public.campaign_enrollments",
  "public.mail_brand_dispatch_admissions",
  "public.gmail_api_slots",
  "public.gmail_api_usage",
  "public.command_receipts",
  "public.audit_log",
  "mail_runtime.routes",
  "mail_runtime.attempts",
  "mail_runtime.sync_checkpoints",
  "mail_runtime.sync_cycles",
];
const dataDigest = `data_state:='{}'::jsonb;for k in select unnest(array[${dataTables.map(lit).join(",")}]) loop
 execute format($q$select md5(coalesce(string_agg(md5((to_jsonb(t)-$1)::text),'' order by (to_jsonb(t)-$1)::text collate "C"),'')) from %s t$q$,k::regclass)
 into data_hash using case when k='public.mail_provider_bindings' then array['quota_contract_version','quota_policy_id','quota_policy_generation'] else array[]::text[] end;
 data_state:=data_state||jsonb_build_object(k,data_hash);end loop;`;
const declarations = `observed jsonb;expected jsonb;g text;k text;v jsonb;a jsonb;mismatches jsonb;queue_state jsonb;queue_ok boolean;protected_state jsonb;data_state jsonb;data_hash text;`;
const emptyState = `exists(select 1 from mail_quota.head where id=1 and policy_id is null and generation is null and not closed)
 and not exists(select 1 from mail_quota.policies) and not exists(select 1 from mail_quota.reservations)
 and not exists(select 1 from mail_quota.usage) and not exists(select 1 from mail_quota.binding_checks)
 and not exists(select 1 from mail_quota.binding_budgets) and not exists(select 1 from mail_quota.binding_contexts)
 and not exists(select 1 from public.mail_provider_bindings where quota_contract_version<>1)`;
const inventory = `for g in select jsonb_object_keys(observed) loop for k in select jsonb_object_keys(observed->g) loop
 if (k like 'mail_quota.%' or (g='schemas' and k='mail_quota') or (g='functions' and split_part(k,'(',1) ~ '^public\\.(composio_binding_.*_v2|mail_quota_.*)$')) and not(d->'post'->g ? k) then
 mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group',g,'object',k,'fields',jsonb_build_array('unexpected_object')));end if;end loop;end loop;`;
export function prepare(sql) {
  assert.equal(
    fs.readdirSync("supabase/migrations").filter((n) => /^052_/.test(n)).length,
    0,
    "052 allocated elsewhere",
  );
  const i04 = JSON.parse(read(qgr + "i04-manifest.json"));
  for (const s of [...i04.sources, ...i04.artifacts])
    assert.equal(hash(fs.readFileSync(s.path)), s.sha256, s.path);
  const captureCatalog = () =>
    JSON.parse(sql("set search_path=pg_catalog,pg_temp;" + catalog));
  const body = ddl(),
    before = captureCatalog();
  sql("begin;" + body + "rollback;");
  assert.deepEqual(captureCatalog(), before, "DDL rollback");
  sql("begin;" + body + "commit;");
  const after = captureCatalog();
  const { pre, post } = runtimeDiff(before, after),
    dependencies = { relations: {}, functions: {} };
  const refs = new Set(
    [
      ...body.matchAll(
        /\b(public|mail_runtime|composio_c1|composio_connect|brand_b2)\.([a-z_][a-z0-9_]*)/g,
      ),
    ].map((m) => m[1] + "." + m[2]),
  );
  refs.add("public.workspace_stats_base");
  for (const group of ["relations", "functions"])
    for (const [key, value] of Object.entries(before[group]))
      if (refs.has(key.split("(")[0]) && !(key in pre[group]))
        dependencies[group][key] = value;
  const contract = {
    protocol: "QGR-FINAL-r1",
    ordinal: "052",
    sources: sourcePaths.map((path) => ({
      path,
      sha256: hash(fs.readFileSync(path)),
    })),
    pre,
    post,
    dependencies,
    protectedDataTables: dataTables,
  };
  const contractText = JSON.stringify(contract, null, 2) + "\n",
    digest = hash(contractText),
    binding = `d jsonb:=${lit(JSON.stringify(contract))}::jsonb;`;
  const report = (
    kind,
    extra,
  ) => `perform set_config('pipeline_os.qgr_final_report',jsonb_build_object('protocol','QGR-FINAL-r1','ordinal','052','contractSha256',${lit(digest)},${extra})::text,true);end $qgr$;
select current_setting('pipeline_os.qgr_final_report')::jsonb pipeline_os_quota_${kind};\n`;
  const start = (readonly) =>
    `begin isolation level ${readonly ? "repeatable read read only" : "serializable"};\nset local search_path=pg_catalog,pg_temp;set local lock_timeout='5s';set local statement_timeout='90s';\n`;
  const checkBase = `${capture} expected:=d->'dependencies';${compare} if jsonb_array_length(mismatches)>0 then raise exception 'QGR_DEPENDENCY_MISMATCH' using detail=(select jsonb_agg(value)::text from(select value from jsonb_array_elements(mismatches) limit 30)x);end if;
 expected:=d->'pre';${compare} if to_regnamespace('mail_quota') is not null then mismatches:=mismatches||jsonb_build_array(jsonb_build_object('group','schemas','object','mail_quota','fields',jsonb_build_array('already_present')));end if;`;
  const preflight =
    "-- QGR052 READ ONLY. No execution authorization.\n" +
    start(true) +
    `do $qgr$ declare ${binding}${declarations} begin
 if not(${context}) then raise exception 'QGR_CONTEXT_MISMATCH';end if;${checkBase}${queue}
 ` +
    report(
      "preflight",
      `'catalogOk',jsonb_array_length(mismatches)=0,'queueOk',queue_ok,'queue',queue_state,'mismatchCount',jsonb_array_length(mismatches),'mismatches',(select coalesce(jsonb_agg(value),'[]') from(select value from jsonb_array_elements(mismatches) limit 30)x),'publicationReady',false,'limits',jsonb_build_array('snapshot_not_process_pause','remote_identity_and_flags_not_checked','linux_build_and_operator_release_authorization_required')`,
    ) +
    "commit;\n";
  const locks = dataTables.map((k) => k).join(",");
  const application =
    "-- QGR052 definitive artifact; apply only after separate authorization and matching preflight.\n" +
    start(false) +
    `do $qgr$ declare ${binding}${declarations} begin
 if not(${context}) then raise exception 'QGR_CONTEXT_MISMATCH';end if;perform pg_advisory_xact_lock(20261110,52);
 lock table ${locks} in share row exclusive mode;
 ${checkBase}if jsonb_array_length(mismatches)>0 then raise exception 'QGR_BASE_MISMATCH' using detail=(select jsonb_agg(value)::text from(select value from jsonb_array_elements(mismatches) limit 30)x);end if;
 ${queue}if not queue_ok then raise exception 'QGR_NOT_QUIESCENT';end if;
 ${preserved("protected_state")}${dataDigest}perform set_config('pipeline_os.qgr_catalog_before',protected_state::text,true);perform set_config('pipeline_os.qgr_data_before',data_state::text,true);end $qgr$;
 ${body}
do $qgr$ declare ${binding}${declarations} begin ${capture}expected:=d->'post';${compare}${inventory}
 if jsonb_array_length(mismatches)>0 then raise exception 'QGR_FINAL_CONTRACT_MISMATCH' using detail=(select jsonb_agg(value)::text from(select value from jsonb_array_elements(mismatches) limit 30)x);end if;
 ${preserved("protected_state")}${dataDigest}
 if protected_state is distinct from current_setting('pipeline_os.qgr_catalog_before')::jsonb or data_state is distinct from current_setting('pipeline_os.qgr_data_before')::jsonb then raise exception 'QGR_PRESERVATION_MISMATCH';end if;
 if not(${emptyState}) then raise exception 'QGR_INITIAL_STATE_MISMATCH';end if;
 ` +
    report(
      "application",
      `'stage','checked_before_commit','targetsOk',true,'preservationMatches',true,'protectedCatalog',md5(protected_state::text),'protectedData',md5(data_state::text),'gmailProviderExpected','gmail_oauth','composioEnabledExpected',false,'policyPublished',false`,
    ) +
    "notify pgrst,'reload schema';\ncommit;\n";
  const postflight =
    "-- QGR052 independent READ ONLY postflight.\n" +
    start(true) +
    `do $qgr$ declare ${binding}${declarations} begin
 if not(${context}) then raise exception 'QGR_CONTEXT_MISMATCH';end if;${capture}expected:=d->'post';${compare}${inventory}
 ` +
    report(
      "postflight",
      `'targetsOk',jsonb_array_length(mismatches)=0,'mismatchCount',jsonb_array_length(mismatches),'mismatches',(select coalesce(jsonb_agg(value),'[]') from(select value from jsonb_array_elements(mismatches) limit 30)x),'initialStateOk',(${emptyState}),'publicationReady',false,'gmailProviderExpected','gmail_oauth','composioEnabledExpected',false`,
    ) +
    "commit;\n";
  const newPublic = Object.keys(post.functions).filter(
    (k) => k.startsWith("public.") && pre.functions[k] === null,
  );
  const rollback =
    start(false) +
    `do $qgr$ begin if not(${context}) then raise exception 'QGR_CONTEXT_MISMATCH';end if;
 lock table ${locks},mail_quota.head in share row exclusive mode;
 if not(${emptyState}) then raise exception 'QGR_ROLLBACK_SCOPE_ALREADY_USED';end if;end $qgr$;\n` +
    newPublic
      .map(
        (k) =>
          `revoke all on function ${k} from public,anon,authenticated,service_role;`,
      )
      .join("\n") +
    `\nselect jsonb_build_object('protocol','QGR-FINAL-r1','ordinal','052','newRpcRevoked',true,'dataDeleted',false,'countersReset',false) pipeline_os_quota_rollback;\ncommit;\n`;
  const files = {
    "contract.json": contractText,
    "052_integrate_mail_quota_and_existing_bindings.sql": application,
    "preflight.sql": preflight,
    "postflight.sql": postflight,
    "rollback-disabled-unused.sql": rollback,
    "cleanup.sql": "rollback;\n",
  };
  fs.mkdirSync(root, { recursive: true });
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(root + name, value);
  return { contract, digest, files, body };
}
