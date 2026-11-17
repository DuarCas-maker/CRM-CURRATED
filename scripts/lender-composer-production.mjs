// Authorized 056 release only. Runtime credentials are never printed or saved.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { guardLenderMigration } from "./lender-composer-release-plan.mjs";
const directory = "docs/specs/lender-composer-20261116/publication";
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
if (
  origin.hostname !== "supabase.finlabinc.com" ||
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw Error("PRODUCTION_TARGET_MISMATCH");
origin.port = "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw Error("API_CREDENTIAL_UNAVAILABLE");
const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const shell = (v) => "'" + String(v).replaceAll("'", "'\\''") + "'";
await mkdir(directory, { recursive: true });
async function query(sql, timeout = 30000) {
  const r = await fetch(new URL("/pg/query", origin), {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(body)) {
    const detail =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : body?.error?.message || "No structured detail";
    const safe = String(detail)
      .replace(/[\w.+-]+@[\w.-]+/g, "[email]")
      .replace(/https?:\/\/\S+/g, "[url]")
      .replace(/[A-Za-z0-9_-]{60,}/g, "[long value]")
      .slice(0, 500);
    await writeFile(
      `${directory}/last-sql-error.json`,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          status: r.status,
          code: body?.code || body?.error?.code || null,
          detail: safe,
        },
        null,
        2,
      ),
    );
    throw Error("PRODUCTION_SQL_HTTP_" + r.status + ": " + safe);
  }
  return body;
}
async function save(name, value) {
  const report = { at: new Date().toISOString(), ...value };
  await writeFile(
    `${directory}/${name}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
const changed =
  "p.proname in ('queue_mail_lenders','queue_lender_emails','save_lender_email_template')";
const catalog = `select jsonb_build_object('database',current_database(),'sql_role',current_user,'version',current_setting('server_version_num'),
 'foundation_055',to_regprocedure('public.case_flow_command(uuid,jsonb)') is not null,
 'templates',to_regclass('public.lender_email_templates') is not null,'versions',to_regclass('public.lender_email_template_versions') is not null,
 'private_schema',to_regnamespace('lender_composer_private') is not null,
 'new_rpc',to_regprocedure('public.save_lender_email_template(jsonb,uuid)') is not null,
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'hash',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'search_path',p.proconfig,'acl',p.proacl::text,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and (${changed})),
 'untouched_hash',(select md5(string_agg(concat_ws('|',p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.prosrc,p.proacl::text,p.proconfig::text,p.prosecdef::text),'~' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','s01_i02','brand_b1','brand_b2','composio_c1') and p.prokind='f' and not (${changed})),
 'can_send_hash',md5(pg_get_functiondef('public.can_send(uuid)'::regprocedure)),
 'selection_constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.mail_recipient_selections'::regclass and conname='mail_recipient_selections_targets_check'),
 'queue_recognized',strpos(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure),'jsonb_array_length(input->''targets'') not between 1 and 20')>0 and strpos(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure),'target->>''email'',input->>''subject_text'',input->>''body_text'',')>0,
 'source_guard',strpos(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure),'s01_i02.assert_sources')>0,
 'area_guard',strpos(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure),'public.can_area')>0,
 'personalized_html',strpos(pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure),'target->>''body_html''')>0,
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'anon_select',has_table_privilege('anon',c.oid,'SELECT'),'auth_select',has_table_privilege('authenticated',c.oid,'SELECT'),'auth_update',has_table_privilege('authenticated',c.oid,'UPDATE'))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('lender_email_templates','lender_email_template_versions'))) result;`;
const action = process.argv[2];
if (["preflight", "postflight", "inspect"].includes(action)) {
  const rows = await query(
    "begin read only;set local search_path=pg_catalog,public,pg_temp;set local statement_timeout=10000;" +
      catalog +
      "rollback;",
  );
  const result = rows.find((r) => r.result)?.result;
  if (
    result?.database !== "postgres" ||
    result.sql_role !== "supabase_admin" ||
    !result.foundation_055 ||
    !result.source_guard ||
    !result.area_guard
  )
    throw Error("CATALOG_IDENTITY_OR_GUARDS_MISMATCH");
  if (
    action === "preflight" &&
    (result.templates ||
      result.versions ||
      result.private_schema ||
      result.new_rpc ||
      !result.queue_recognized)
  )
    throw Error("056_ALREADY_PRESENT_OR_QUEUE_DERIVED");
  if (action === "postflight") {
    const before = JSON.parse(
      await readFile(`${directory}/preflight.json`, "utf8"),
    ).result;
    if (
      !result.templates ||
      !result.versions ||
      !result.private_schema ||
      !result.new_rpc ||
      !result.personalized_html ||
      result.queue_recognized ||
      result.untouched_hash !== before.untouched_hash ||
      result.can_send_hash !== before.can_send_hash ||
      result.tables?.length !== 2
    )
      throw Error("POSTFLIGHT_CATALOG_MISMATCH");
    if (
      result.tables.some(
        (t) => !t.rls || t.anon_select || !t.auth_select || t.auth_update,
      )
    )
      throw Error("TABLE_PERMISSION_MISMATCH");
    const fn = result.functions.find(
      (f) => f.name === "save_lender_email_template",
    );
    if (
      !fn ||
      fn.owner !== "supabase_admin" ||
      !fn.definer ||
      fn.anon ||
      !fn.authenticated
    )
      throw Error("RPC_PERMISSION_MISMATCH");
    for (const old of before.functions)
      if (result.functions.find((f) => f.name === old.name)?.acl !== old.acl)
        throw Error("QUEUE_GRANT_DRIFT");
  }
  await save(action, { readOnly: true, result });
} else if (action === "validate-guard") {
  const before = JSON.parse(
    await readFile(`${directory}/preflight.json`, "utf8"),
  ).result;
  const checks = before.functions
    .map(
      (f) =>
        `md5(pg_get_functiondef(${literal(f.name === "queue_mail_lenders" ? "public.queue_mail_lenders(jsonb)" : "public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid)")}::regprocedure))<>${literal(f.hash)}`,
    )
    .join(" or ");
  const rows = await query(
    `begin read only;set local lock_timeout='5s';set local statement_timeout='10s';select pg_advisory_xact_lock(hashtextextended('lender-composer-056-release',56));do $$begin if current_database()<>'postgres' or current_user<>'supabase_admin' or to_regclass('public.lender_email_templates') is not null or ${checks} then raise exception '056_PREFLIGHT_DRIFT';end if;end $$;select jsonb_build_object('validated',true,'search_path',current_setting('search_path'),'superuser',(select rolsuper from pg_roles where rolname=current_user)) result;rollback;`,
  );
  await save("guard-validation", {
    readOnly: true,
    result: rows.find((r) => r.result)?.result,
  });
} else if (action === "backup") {
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const path = `/var/lib/postgresql/data/lender-composer-056-${stamp}`;
  const plan = {
    path,
    dump: path + "/pre056.dump",
    status: "reserved",
    retries: 0,
  };
  await writeFile(
    `${directory}/backup-attempt.json`,
    JSON.stringify(plan, null, 2),
    { flag: "wx" },
  );
  const program = `set -eu\numask 077\nd=${shell(path)}\ntest ! -e "$d"\nmkdir -m 700 "$d"\npg_dump --no-password --username=supabase_admin --dbname=postgres --format=custom --file="$d/pre056.dump" 2>"$d/backup.stderr"\nchmod 600 "$d/pre056.dump"\npg_restore --list "$d/pre056.dump" >"$d/restore-list.txt" 2>"$d/restore-list.stderr"\npg_restore --file=/dev/null "$d/pre056.dump" 2>"$d/restore-decode.stderr"\nsha256sum "$d/pre056.dump" | cut -d ' ' -f 1 >"$d/sha256.txt"\nprintf verified >"$d/status.txt"`;
  const rows = await query(
    `set statement_timeout=120000;do $$begin if current_database()<>'postgres' or current_setting('data_directory')<>'/var/lib/postgresql/data' then raise exception 'BACKUP_TARGET_MISMATCH';end if;end $$;copy (select '') to program ${literal("sh -c " + shell(program))};select jsonb_build_object('bytes',(pg_stat_file(${literal(plan.dump)})).size,'sha256',btrim(pg_read_file(${literal(path + "/sha256.txt")})),'verified',pg_read_file(${literal(path + "/status.txt")})='verified') result;`,
    125000,
  );
  const result = rows.find((r) => r.result)?.result;
  if (result?.sha256) result.sha256 = result.sha256.trim();
  if (
    !result?.verified ||
    !result.bytes ||
    !/^[a-f0-9]{64}$/.test(result.sha256)
  )
    throw Error("BACKUP_UNVERIFIED_INSPECT_BEFORE_RETRY");
  await save("backup-result", {
    ...plan,
    ...result,
    status: "verified",
    serverOnly: true,
    restorationCheck: "list and complete decode; no full disaster restore",
  });
} else if (action === "diagnose-rollback") {
  const sql = await readFile(
    "supabase/migrations/056_lender_composer.sql",
    "utf8",
  );
  if (!sql.startsWith("begin;") || !/commit;\s*$/.test(sql))
    throw Error("UNRECOGNIZED_MIGRATION");
  const dry = sql
    .replace(
      /^begin;/,
      "begin;set local lock_timeout='5s';set local statement_timeout='30s';",
    )
    .replace(/commit;\s*$/, "rollback;");
  await query(dry, 45000);
  await save("diagnostic-rollback", { rolledBack: true, persistentDdl: false });
} else if (["apply", "apply-retry"].includes(action)) {
  const backup = JSON.parse(
    await readFile(`${directory}/backup-result.json`, "utf8"),
  );
  if (backup.status !== "verified") throw Error("BACKUP_REQUIRED");
  const before = JSON.parse(
    await readFile(`${directory}/preflight.json`, "utf8"),
  ).result;
  const sql = await readFile(
    "supabase/migrations/056_lender_composer.sql",
    "utf8",
  );
  const sha256 = createHash("sha256").update(sql).digest("hex");
  const guarded = guardLenderMigration(sql, before);
  if (action === "apply-retry") {
    const previous = JSON.parse(
      await readFile(`${directory}/migration-attempt.json`, "utf8"),
    );
    const inspected = JSON.parse(
      await readFile(`${directory}/inspect.json`, "utf8"),
    );
    const diagnostic = JSON.parse(
      await readFile(`${directory}/diagnostic-rollback.json`, "utf8"),
    );
    if (
      previous.sha256 !== sha256 ||
      inspected.result.templates ||
      inspected.result.new_rpc ||
      !diagnostic.rolledBack
    )
      throw Error("RETRY_REQUIRES_CONFIRMED_ABSENCE_AND_UNCHANGED_MIGRATION");
  }
  await writeFile(
    `${directory}/${action === "apply" ? "migration-attempt" : "migration-retry-attempt"}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        sha256,
        status: "reserved",
        retries: action === "apply" ? 0 : 1,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  await query(guarded, 45000);
  await save("migration-result", {
    status: "applied",
    sha256,
    realDataImport: false,
    mailSent: false,
  });
} else if (action === "harden-grants") {
  const migration = JSON.parse(
    await readFile(`${directory}/migration-result.json`, "utf8"),
  );
  if (migration.status !== "applied") throw Error("056_REQUIRED");
  const sql = await readFile(
    "supabase/migrations/057_lender_template_grants.sql",
    "utf8",
  );
  const sha256 = createHash("sha256").update(sql).digest("hex");
  await writeFile(
    `${directory}/grants-attempt.json`,
    JSON.stringify(
      { at: new Date().toISOString(), sha256, status: "reserved" },
      null,
      2,
    ),
    { flag: "wx" },
  );
  await query(
    "set lock_timeout='5s';set statement_timeout='15s';" + sql,
    25000,
  );
  await save("grants-result", {
    status: "applied",
    migration: "057_lender_template_grants.sql",
    sha256,
    defaultPrivilegesChanged: false,
  });
} else if (action === "fixture-smoke") {
  const rows = await query(
    await readFile(`${directory}/fixture-smoke.sql`, "utf8"),
    45000,
  );
  const checks = rows.find((r) => r.result)?.result;
  if (
    !checks?.template_crud ||
    !checks.selection_73 ||
    !checks.aal1_blocked ||
    checks.mail_queued
  )
    throw Error("FIXTURE_SMOKE_FAILED");
  const verification = await query(
    "begin read only;select not exists(select 1 from public.lender_email_templates where name='FICTIONAL 056 ROLLBACK QA') and not exists(select 1 from public.mail_recipient_selections where name='FICTIONAL 056 ROLLBACK QA') as clean;rollback;",
  );
  if (!verification.some((r) => r.clean === true))
    throw Error("FIXTURE_ROLLBACK_NOT_CONFIRMED");
  await save("fixture-smoke", {
    checks,
    rolledBack: true,
    noPersistentBusinessWrites: true,
    sqlSessionContextOnly: true,
    realJwtSession: false,
  });
} else throw Error("EXPLICIT_RELEASE_ACTION_REQUIRED");
