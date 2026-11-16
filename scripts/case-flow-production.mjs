// Explicitly authorized 055 release. Credentials are runtime-only; no env files are opened here.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = "docs/specs/case-flow-20261116/publication";
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
origin.port = ""; // Same pinned HTTPS API destination used by the previous authorized release.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw Error("API_CREDENTIAL_UNAVAILABLE");
const literal = (v) => "'" + v.replaceAll("'", "''") + "'",
  shell = (v) => "'" + v.replaceAll("'", "'\\''") + "'";
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
  if (!r.ok || !Array.isArray(body))
    throw Error("PRODUCTION_SQL_HTTP_" + r.status);
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
  "p.proname in ('can_case','can_area','can_edit_case','can_manage_case_flow','case_flow_command','gmail_select_lender','queue_lender_emails') or (n.nspname='s01_i02' and p.proname in ('actor_can_read','actor_can_write'))";
const catalog = `select jsonb_build_object('database',current_database(),'sql_role',current_user,'version',current_setting('server_version_num'),'new_rpc',to_regprocedure('public.case_flow_command(uuid,jsonb)') is not null,'columns',(select jsonb_agg(column_name order by column_name) from information_schema.columns where table_schema='public' and ((table_name='case_events' and column_name='workflow_value') or (table_name='submissions' and column_name in ('requirements_state','agreed_amount')))),
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'hash',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'search_path',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE')) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and (${changed})),
 'untouched_hash',(select md5(string_agg(concat_ws('|',p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.prosrc,p.proacl::text,p.proconfig::text,p.prosecdef::text),'~' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','s01_i02','brand_b1','brand_b2','composio_c1') and p.prokind='f' and not (${changed})),
 'can_send_hash',md5(pg_get_functiondef('public.can_send(uuid)'::regprocedure)),
 'queue_owner_recognized',strpos(pg_get_functiondef('public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid)'::regprocedure),'select closer_id into closer from public.opportunities where opportunities.id=case_id;')>0,
 'users_054',to_regclass('public.user_private_fields') is not null,'index_ready',to_regclass('public.case_flow_event_lookup') is not null) result;`;
const action = process.argv[2];
if (action === "preflight" || action === "postflight") {
  const rows = await query(
    "begin read only;set local statement_timeout=10000;" +
      catalog +
      "rollback;",
  );
  const result = rows.find((r) => r.result)?.result;
  if (
    result?.database !== "postgres" ||
    result.sql_role !== "supabase_admin" ||
    !result.users_054
  )
    throw Error("CATALOG_IDENTITY_MISMATCH");
  if (
    action === "preflight" &&
    (result.new_rpc || result.columns?.length || !result.queue_owner_recognized)
  )
    throw Error("055_ALREADY_PRESENT_OR_QUEUE_DERIVED");
  if (action === "postflight") {
    const before = JSON.parse(
      await readFile(`${directory}/preflight.json`, "utf8"),
    ).result;
    if (
      !result.new_rpc ||
      result.columns?.length !== 3 ||
      !result.index_ready ||
      result.can_send_hash !== before.can_send_hash ||
      result.untouched_hash !== before.untouched_hash
    )
      throw Error("POSTFLIGHT_CATALOG_MISMATCH");
    const fn = result.functions.find((f) => f.name === "case_flow_command");
    if (
      !fn ||
      fn.owner !== "supabase_admin" ||
      !fn.definer ||
      fn.anon ||
      !fn.authenticated
    )
      throw Error("RPC_PERMISSION_MISMATCH");
  }
  await save(action, { readOnly: true, result });
} else if (action === "backup") {
  const stamp =
      new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
    path = `/var/lib/postgresql/data/case-flow-055-${stamp}`;
  const plan = {
    path,
    dump: path + "/pre055.dump",
    status: "reserved",
    retries: 0,
  };
  await writeFile(
    `${directory}/backup-attempt.json`,
    JSON.stringify(plan, null, 2),
    { flag: "wx" },
  );
  const program = `set -eu\numask 077\nd=${shell(path)}\ntest ! -e "$d"\nmkdir -m 700 "$d"\npg_dump --no-password --username=supabase_admin --dbname=postgres --format=custom --file="$d/pre055.dump" 2>"$d/backup.stderr"\nchmod 600 "$d/pre055.dump"\npg_restore --list "$d/pre055.dump" >"$d/restore-list.txt" 2>"$d/restore-list.stderr"\npg_restore --file=/dev/null "$d/pre055.dump" 2>"$d/restore-decode.stderr"\nsha256sum "$d/pre055.dump" | cut -d ' ' -f 1 >"$d/sha256.txt"\nprintf verified >"$d/status.txt"`;
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
    throw Error("BACKUP_UNVERIFIED");
  await save("backup-result", {
    ...plan,
    ...result,
    status: "verified",
    serverOnly: true,
    restorationCheck: "list and complete decode; no full disaster restore",
  });
} else if (action === "backup-inspect") {
  const plan = JSON.parse(
    await readFile(`${directory}/backup-attempt.json`, "utf8"),
  );
  if (!/^\/var\/lib\/postgresql\/data\/case-flow-055-[0-9TZ]+$/.test(plan.path))
    throw Error("BACKUP_PATH_MISMATCH");
  const rows = await query(
    `begin read only;select jsonb_build_object('bytes',(pg_stat_file(${literal(plan.dump)})).size,'sha256',pg_read_file(${literal(plan.path + "/sha256.txt")}),'verified',pg_read_file(${literal(plan.path + "/status.txt")})='verified') result;rollback;`,
  );
  const result = rows.find((r) => r.result)?.result;
  if (result?.sha256) result.sha256 = result.sha256.trim();
  if (
    !result?.verified ||
    !result.bytes ||
    !/^[a-f0-9]{64}$/.test(result.sha256)
  )
    throw Error("BACKUP_UNVERIFIED");
  await save("backup-result", {
    ...plan,
    ...result,
    status: "verified",
    serverOnly: true,
    recoveredByReadOnlyInspection: true,
    restorationCheck: "list and complete decode; no full disaster restore",
  });
} else if (action === "apply") {
  const backup = JSON.parse(
    await readFile(`${directory}/backup-result.json`, "utf8"),
  );
  if (backup.status !== "verified") throw Error("BACKUP_REQUIRED");
  const sql = await readFile("supabase/migrations/055_case_flow.sql", "utf8"),
    sha256 = createHash("sha256").update(sql).digest("hex");
  await writeFile(
    `${directory}/migration-attempt.json`,
    JSON.stringify(
      { at: new Date().toISOString(), sha256, status: "reserved", retries: 0 },
      null,
      2,
    ),
    { flag: "wx" },
  );
  await query(
    `set lock_timeout='5s';set statement_timeout='30s';do $$begin if current_database()<>'postgres' or to_regprocedure('public.case_flow_command(uuid,jsonb)') is not null then raise exception '055_TARGET_NOT_EMPTY';end if;end $$;` +
      sql,
    45000,
  );
  await save("migration-result", {
    status: "applied",
    sha256,
    realDataImport: false,
    mailSent: false,
  });
} else if (action === "fixture-smoke") {
  const sql = await readFile(`${directory}/fixture-smoke.sql`, "utf8");
  const rows = await query(sql, 45000),
    checks = rows.find((r) => r.result)?.result;
  if (
    !checks ||
    !checks.report_approval ||
    !checks.single_selected ||
    !checks.aal1_blocked
  )
    throw Error("FIXTURE_SMOKE_FAILED");
  const verification = await query(
    "begin read only;select not exists(select 1 from public.opportunities where company='FICTIONAL 055 ROLLBACK TEST') and not exists(select 1 from public.contacts where email like 'case-flow-qa-%@example.invalid') as clean;rollback;",
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
