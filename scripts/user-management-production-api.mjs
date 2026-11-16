// Authorized operations only. Runtime credentials are never printed or persisted.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = "docs/specs/user-management/publication";
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
if (
  origin.hostname !== "supabase.finlabinc.com" ||
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("PRODUCTION_TARGET_MISMATCH");
origin.port = "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("PRODUCTION_API_CREDENTIAL_UNAVAILABLE");
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const shellLiteral = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
await mkdir(directory, { recursive: true });
async function query(sql, timeout = 30000) {
  const response = await fetch(new URL("/pg/query", origin), {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }),
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body))
    throw new Error(`PRODUCTION_SQL_REQUEST_FAILED_HTTP_${response.status}`);
  return body;
}
const action = process.argv[2];
if (action === "backup") {
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const backup = `/var/lib/postgresql/data/users-054-${stamp}`;
  const plan = {
    action,
    at: new Date().toISOString(),
    directory: backup,
    dump: `${backup}/pre054.dump`,
    status: "reserved",
    retries: 0,
  };
  await writeFile(
    `${directory}/backup-attempt.json`,
    JSON.stringify(plan, null, 2) + "\n",
    { flag: "wx" },
  );
  const program = `set -eu\numask 077\nd=${shellLiteral(backup)}\ntest ! -e "$d"\nmkdir -m 700 "$d"\npg_dump --no-password --username=supabase_admin --dbname=postgres --format=custom --file="$d/pre054.dump" 2>"$d/backup.stderr"\nchmod 600 "$d/pre054.dump"\npg_restore --list "$d/pre054.dump" >"$d/restore-list.txt" 2>"$d/restore-list.stderr"\npg_restore --file=/dev/null "$d/pre054.dump" 2>"$d/restore-decode.stderr"\nsha256sum "$d/pre054.dump" | cut -d ' ' -f 1 >"$d/sha256.txt"\nprintf verified >"$d/status.txt"`;
  const sql = `set statement_timeout=120000; do $$begin if current_database()<>'postgres' or current_setting('data_directory')<>'/var/lib/postgresql/data' then raise exception 'BACKUP_TARGET_MISMATCH';end if;end $$; copy (select '') to program ${literal("sh -c " + shellLiteral(program))}; select jsonb_build_object('bytes',(pg_stat_file(${literal(plan.dump)})).size,'sha256',btrim(pg_read_file(${literal(backup + "/sha256.txt")})),'verified',pg_read_file(${literal(backup + "/status.txt")})='verified') as user_backup;`;
  const rows = await query(sql, 125000);
  const result = rows.find((row) => row.user_backup)?.user_backup;
  if (result?.sha256) result.sha256 = result.sha256.trim();
  if (
    !result?.verified ||
    !/^[a-f0-9]{64}$/.test(result.sha256) ||
    result.bytes < 1
  )
    throw new Error("BACKUP_NOT_VERIFIED");
  const report = {
    ...plan,
    status: "verified",
    ...result,
    serverOnly: true,
    restorationTest:
      "pg_restore list and complete decode; not a full server disaster restore",
  };
  await writeFile(
    `${directory}/backup-result.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} else if (action === "backup-inspect") {
  const plan = JSON.parse(
    await readFile(`${directory}/backup-attempt.json`, "utf8"),
  );
  if (
    !/^\/var\/lib\/postgresql\/data\/users-054-[0-9TZ]+$/.test(plan.directory)
  )
    throw new Error("BACKUP_PATH_MISMATCH");
  const rows = await query(
    `begin read only;select jsonb_build_object('bytes',(pg_stat_file(${literal(plan.dump)})).size,'sha256',pg_read_file(${literal(plan.directory + "/sha256.txt")}), 'verified',pg_read_file(${literal(plan.directory + "/status.txt")})='verified') as user_backup;rollback;`,
  );
  const result = rows.find((row) => row.user_backup)?.user_backup;
  if (result?.sha256) result.sha256 = result.sha256.trim();
  if (
    !result?.verified ||
    !/^[a-f0-9]{64}$/.test(result.sha256) ||
    result.bytes < 1
  )
    throw new Error("BACKUP_NOT_VERIFIED");
  const report = {
    ...plan,
    status: "verified",
    ...result,
    serverOnly: true,
    recoveredByReadOnlyInspection: true,
    restorationTest:
      "pg_restore list and complete decode; not a full server disaster restore",
  };
  await writeFile(
    `${directory}/backup-result.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} else if (action === "permissions") {
  const rows = await query(`begin read only;set local statement_timeout=10000;
    do $$declare actor uuid;checks jsonb:='{}';blocked boolean;begin
      select id into actor from public.profiles where role='superadmin' and active order by id limit 1;
      if actor is null then raise exception 'NO_ACTIVE_SUPERADMIN';end if;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
      perform public.user_management_list('__users_054_probe_no_matches__',0);
      checks:=checks||jsonb_build_object('superadmin_aal2_allowed',true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal1')::text,true);
      blocked:=false;begin perform public.user_management_list('',0);exception when others then if sqlerrm='USER_FORBIDDEN' then blocked:=true;else raise;end if;end;
      if not blocked then raise exception 'AAL1_NOT_BLOCKED';end if;checks:=checks||jsonb_build_object('aal1_blocked',true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000000','role','authenticated','aal','aal2')::text,true);
      blocked:=false;begin perform public.user_management_list('',0);exception when others then if sqlerrm='USER_FORBIDDEN' then blocked:=true;else raise;end if;end;
      if not blocked then raise exception 'MISSING_PROFILE_NOT_BLOCKED';end if;checks:=checks||jsonb_build_object('missing_profile_blocked',true);
      blocked:=false;begin perform public.user_management_assert_actor('00000000-0000-4000-8000-000000000000');exception when others then if sqlerrm='USER_FORBIDDEN' then blocked:=true;else raise;end if;end;
      if not blocked then raise exception 'SERVICE_ACTOR_NOT_BLOCKED';end if;checks:=checks||jsonb_build_object('invalid_service_actor_blocked',true);
      perform set_config('users054.checks',checks::text,true);
    end $$;select current_setting('users054.checks')::jsonb as permission_checks;rollback;`);
  const result = rows.find((row) => row.permission_checks)?.permission_checks;
  if (!result || Object.values(result).some((value) => value !== true))
    throw new Error("PERMISSION_SQL_PROBE_FAILED");
  let anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let publicAssetsRead = 0;
  if (!anon) {
    const crm = new URL("https://crm.finlabinc.com");
    const page = await fetch(new URL("/login", crm), {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!page.ok) throw new Error("PUBLIC_LOGIN_UNAVAILABLE");
    const html = await page.text();
    const assets = [
      ...new Set(
        [...html.matchAll(/<script[^>]+src="([^\"]+)"/g)].map(
          (match) => match[1],
        ),
      ),
    ].slice(0, 12);
    for (const path of assets) {
      const url = new URL(path, crm);
      if (
        url.origin !== crm.origin ||
        !url.pathname.startsWith("/_next/static/")
      )
        continue;
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      publicAssetsRead++;
      if (!response.ok) continue;
      const source = await response.text();
      for (const match of source.matchAll(
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      )) {
        try {
          if (
            JSON.parse(
              Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"),
            ).role === "anon"
          ) {
            anon = match[0];
            break;
          }
        } catch {}
      }
      if (anon) break;
    }
  }
  const probes = [];
  for (const [name, path, apiKey, method, body, allowed] of [
    [
      "anonymous_private_table",
      "/rest/v1/user_private_fields?select=user_id&limit=0",
      anon,
      "GET",
      null,
      false,
    ],
    [
      "anonymous_admin_rpc",
      "/rest/v1/rpc/user_management_list",
      anon,
      "POST",
      { p_search: "__users_054_probe_no_matches__", p_page: 0 },
      false,
    ],
    [
      "service_private_table",
      "/rest/v1/user_private_fields?select=user_id&limit=0",
      key,
      "GET",
      null,
      true,
    ],
    [
      "service_cannot_impersonate_human",
      "/rest/v1/rpc/user_management_list",
      key,
      "POST",
      { p_search: "__users_054_probe_no_matches__", p_page: 0 },
      false,
    ],
  ]) {
    if (!apiKey) throw new Error("PUBLIC_PROBE_KEY_MISSING");
    const response = await fetch(new URL(path, origin), {
      method,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    await response.body?.cancel();
    if (response.ok !== allowed)
      throw new Error(
        `REST_PERMISSION_PROBE_FAILED_${name}_${response.status}`,
      );
    probes.push({ name, status: response.status, allowed: response.ok });
  }
  const report = {
    action,
    at: new Date().toISOString(),
    readOnly: true,
    sqlSessionContextOnly: true,
    noUserRoleOrPasswordChanges: true,
    checks: result,
    rest: probes,
    publicAssetsRead,
    nonAdminActualJwtSessionsTested: false,
  };
  await writeFile(
    `${directory}/permission-checks.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} else if (action === "catalog" || action === "postflight") {
  const rows = await query(`begin read only;set local statement_timeout=10000;
    select jsonb_build_object('legacy_functions_hash',md5(coalesce(string_agg(concat_ws('|',p.oid::regprocedure::text,pg_get_userbyid(p.proowner),p.prosrc,p.proacl::text,p.proconfig::text,p.prosecdef::text),'~' order by p.oid::regprocedure::text),'')),'legacy_functions_count',count(*),
    'profile_access_hash',(select md5(coalesce(string_agg(id::text||':'||role::text||':'||active::text,'~' order by id),'')) from public.profiles),
    'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',f.proname,'owner',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'empty_search_path',f.proconfig=array['search_path=""'],'anon_execute',has_function_privilege('anon',f.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',f.oid,'EXECUTE'),'service_execute',has_function_privilege('service_role',f.oid,'EXECUTE')) order by f.proname),'[]') from pg_proc f join pg_namespace fn on fn.oid=f.pronamespace where fn.nspname='public' and f.proname like 'user_management_%'),
    'private_table',(select jsonb_build_object('rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'anon_select',has_table_privilege('anon',c.oid,'SELECT'),'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),'authenticated_write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'),'service_select',has_table_privilege('service_role',c.oid,'SELECT')) from pg_class c where c.oid=to_regclass('public.user_private_fields')))
    as catalog_054 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname not like 'user_management_%';rollback;`);
  const result = rows.find((row) => row.catalog_054)?.catalog_054;
  if (!result?.legacy_functions_hash) throw new Error("CATALOG_NOT_CONFIRMED");
  if (action === "postflight") {
    const before = JSON.parse(
      await readFile(`${directory}/catalog-before.json`, "utf8"),
    ).result;
    if (
      result.legacy_functions_hash !== before.legacy_functions_hash ||
      result.legacy_functions_count !== before.legacy_functions_count ||
      result.profile_access_hash !== before.profile_access_hash
    )
      throw new Error("EXISTING_CATALOG_CHANGED");
    if (
      result.functions.length !== 7 ||
      !result.private_table?.rls ||
      result.private_table.anon_select ||
      result.private_table.authenticated_select ||
      result.private_table.authenticated_write ||
      !result.private_table.service_select
    )
      throw new Error("PRIVATE_TABLE_PERMISSION_MISMATCH");
    for (const fn of result.functions) {
      const human = ["user_management_list", "user_management_access"].includes(
        fn.name,
      );
      if (
        fn.owner !== "supabase_admin" ||
        !fn.security_definer ||
        !fn.empty_search_path ||
        fn.anon_execute ||
        fn.authenticated_execute !== human ||
        (!human && !fn.service_execute)
      )
        throw new Error("FUNCTION_PERMISSION_MISMATCH");
    }
  }
  const report = {
    action,
    at: new Date().toISOString(),
    readOnly: true,
    result,
  };
  await writeFile(
    `${directory}/${action === "catalog" ? "catalog-before" : "catalog-after"}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} else if (action === "apply") {
  const backup = JSON.parse(
    await readFile(`${directory}/backup-result.json`, "utf8"),
  );
  if (backup.status !== "verified") throw new Error("BACKUP_REQUIRED");
  const sql = await readFile(
    "docs/specs/user-management/migrations/054_user_management.sql",
    "utf8",
  );
  const sha256 = createHash("sha256").update(sql).digest("hex");
  const plan = {
    action,
    at: new Date().toISOString(),
    sha256,
    status: "reserved",
    retries: 0,
  };
  await writeFile(
    `${directory}/migration-attempt.json`,
    JSON.stringify(plan, null, 2) + "\n",
    { flag: "wx" },
  );
  const prefix = `set lock_timeout='5s'; set statement_timeout='30s'; do $$begin if current_database()<>'postgres' or to_regclass('public.user_private_fields') is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'user_management_%') then raise exception 'MIGRATION_TARGET_NOT_EMPTY';end if;end $$;`;
  const rows = await query(
    prefix +
      sql +
      "select jsonb_build_object('table_present',to_regclass('public.user_private_fields') is not null,'new_functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'user_management_%'),'private_rows',(select count(*) from public.user_private_fields)) as applied_054;",
    45000,
  );
  const result = rows.find((row) => row.applied_054)?.applied_054;
  if (
    !result?.table_present ||
    result.new_functions !== 7 ||
    result.private_rows !== 0
  )
    throw new Error("MIGRATION_POSTFLIGHT_NOT_CONFIRMED");
  const report = { ...plan, status: "applied", ...result };
  await writeFile(
    `${directory}/migration-result.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} else throw new Error("EXPLICIT_ACTION_REQUIRED");
