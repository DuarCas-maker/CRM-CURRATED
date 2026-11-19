// Plan is offline. Remote writes require a separate, explicit authorization.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const target = "https://supabase.finlabinc.com";
const indexName = "workspace_import_rows_imported_contact_idx";
const source = fileURLToPath(new URL("./index.sql", import.meta.url));
const directory = resolve(
  ".local/application-performance-20261118/report-index",
);
const sql = await readFile(source, "utf8");
const sha256 = createHash("sha256").update(sql).digest("hex");
const action = process.argv[2] || "plan";
const expected = {
  workspace_stats: "8e058cf7c9f791cd708c4509bb2c1be7",
  workspace_stats_base: "2d22ca1953b8a8072abd161c29486ec8",
};
if (action === "plan") {
  console.log(
    JSON.stringify(
      {
        target,
        database: "postgres",
        action,
        sql,
        sha256,
        stages: [
          "read-only preflight",
          "server-only verified pg_dump",
          "standalone concurrent index",
          "read-only postflight",
          "authenticated Reports smoke",
        ],
        remoteRequests: 0,
        altersRows: false,
        altersFunctionsOrRls: false,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (!["inspect", "backup", "backup-inspect", "apply"].includes(action))
  throw new Error("UNKNOWN_ACTION");
if (
  ["backup", "apply"].includes(action) &&
  !process.argv.includes("--authorized-production-index")
)
  throw new Error("EXPLICIT_INDEX_AUTHORIZATION_REQUIRED");
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
if (
  origin.origin !== target ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw new Error("TARGET_MISMATCH");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("CREDENTIAL_UNAVAILABLE");
await mkdir(directory, { recursive: true });
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const shellLiteral = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function query(statement, timeout = 15000) {
  const response = await fetch(new URL("/pg/query", origin), {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ query: statement }),
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json().catch(() => null);
  // Do not log SQL API error bodies, connection details or rows.
  if (!response.ok || !Array.isArray(body))
    throw new Error("SQL_REQUEST_FAILED_HTTP_" + response.status);
  return body;
}
async function save(name, value, exclusive = false) {
  await writeFile(
    resolve(directory, name + ".json"),
    JSON.stringify(value, null, 2) + "\n",
    exclusive ? { flag: "wx" } : {},
  );
}
async function inspect() {
  const rows = await query(`begin read only;set local statement_timeout='5s';
    select jsonb_build_object('database',current_database(),'version',current_setting('server_version_num'),
      'data_directory',current_setting('data_directory'),
      'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'hash',md5(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),E'\\r',E'\\n')),'invoker',not p.prosecdef)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('workspace_stats','workspace_stats_base')),
      'guards',(select md5(coalesce(string_agg(concat_ws('|',p.oid::regprocedure::text,p.prosrc,p.proacl::text,p.proconfig::text,p.prosecdef::text),'~' order by p.oid::regprocedure::text),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
      'policies',(select md5(coalesce(string_agg(row_to_json(p)::text,'~' order by p.tablename,p.policyname),'')) from pg_policies p where p.schemaname='public'),
      'table_grants',(select md5(coalesce(string_agg(concat_ws('|',c.oid::regclass::text,c.relacl::text,c.relrowsecurity::text,c.relforcerowsecurity::text),'~' order by c.relname),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v')),
      'index',(select jsonb_build_object('table',i.indrelid::regclass::text,'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'columns',i.indnatts,'key',pg_get_indexdef(i.indexrelid,1,true),'predicate',pg_get_expr(i.indpred,i.indrelid),'definition',pg_get_indexdef(i.indexrelid)) from pg_index i where i.indexrelid=to_regclass('public.${indexName}')),
      'building',(select count(*) from pg_stat_progress_create_index where index_relid=to_regclass('public.${indexName}'))
    ) as metadata;rollback;`);
  const m = rows.find((r) => r.metadata)?.metadata;
  if (
    !m ||
    m.database !== "postgres" ||
    Number(m.version) < 150000 ||
    Number(m.version) >= 160000 ||
    m.data_directory !== "/var/lib/postgresql/data"
  )
    throw new Error("DATABASE_IDENTITY_MISMATCH");
  if (
    m.functions?.length !== 2 ||
    m.functions.some((f) => expected[f.name] !== f.hash || !f.invoker)
  )
    throw new Error("FUNCTION_SOURCE_CHANGED");
  if (m.index && !ownIndex(m.index))
    throw new Error("INDEX_NAME_OCCUPIED_BY_DIFFERENT_DEFINITION");
  return m;
}
function ownIndex(index) {
  return (
    ["import_rows", "public.import_rows"].includes(index.table) &&
    index.unique === false &&
    index.columns === 1 &&
    index.key === "contact_id" &&
    index.predicate?.replace(/[\s()]/g, "") === "result='imported'::text"
  );
}
function verifyGuards(before, after) {
  for (const field of ["guards", "policies", "table_grants"])
    if (before[field] !== after[field])
      throw new Error("CATALOG_CHANGED_" + field);
}
async function readBackup() {
  const plan = JSON.parse(
    await readFile(resolve(directory, "backup-attempt.json"), "utf8"),
  );
  if (
    !/^\/var\/lib\/postgresql\/data\/report-index-[0-9TZ]+$/.test(
      plan.directory,
    ) ||
    plan.dump !== plan.directory + "/pre-index.dump"
  )
    throw new Error("BACKUP_PATH_MISMATCH");
  const rows = await query(
    `begin read only;select jsonb_build_object('bytes',(pg_stat_file(${literal(plan.dump)})).size,'sha256',btrim(pg_read_file(${literal(plan.directory + "/sha256.txt")})),'verified',pg_read_file(${literal(plan.directory + "/status.txt")})='verified') as backup;rollback;`,
  );
  const result = rows.find((r) => r.backup)?.backup;
  if (typeof result?.sha256 === "string") result.sha256 = result.sha256.trim();
  if (
    !result?.verified ||
    !/^[a-f0-9]{64}$/.test(result.sha256) ||
    result.bytes < 1
  )
    throw new Error("BACKUP_NOT_VERIFIED");
  return {
    ...plan,
    ...result,
    serverOnly: true,
    restorationTest:
      "Archive listing and complete decode, not a full disaster restore",
  };
}

if (action === "inspect") {
  const result = await inspect();
  await save("inspection-" + Date.now(), result);
  console.log(
    JSON.stringify({ target, action, readOnly: true, ...result }, null, 2),
  );
} else if (action === "backup") {
  const before = await inspect();
  if (before.index || before.building)
    throw new Error("INDEX_ALREADY_PRESENT_OR_BUILDING");
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const backupDirectory = "/var/lib/postgresql/data/report-index-" + stamp;
  const plan = {
    target,
    at: new Date().toISOString(),
    directory: backupDirectory,
    dump: backupDirectory + "/pre-index.dump",
    sqlSha256: sha256,
    catalog: before,
  };
  await save("backup-attempt", plan, true);
  const program = `set -eu\numask 077\nd=${shellLiteral(backupDirectory)}\ntest ! -e "$d"\nmkdir -m 700 "$d"\npg_dump --no-password --username=supabase_admin --dbname=postgres --format=custom --file="$d/pre-index.dump" 2>"$d/backup.stderr"\nchmod 600 "$d/pre-index.dump"\npg_restore --list "$d/pre-index.dump" >"$d/restore-list.txt" 2>"$d/restore-list.stderr"\npg_restore --file=/dev/null "$d/pre-index.dump" 2>"$d/restore-decode.stderr"\nsha256sum "$d/pre-index.dump" | cut -d ' ' -f 1 >"$d/sha256.txt"\nprintf verified >"$d/status.txt"`;
  await query(
    `set statement_timeout=120000;copy (select '') to program ${literal("sh -c " + shellLiteral(program))};`,
    125000,
  );
  const backup = await readBackup();
  await save("backup-result", backup);
  console.log(
    JSON.stringify({
      target,
      action,
      verified: true,
      bytes: backup.bytes,
      sha256: backup.sha256,
      serverOnly: true,
    }),
  );
} else if (action === "backup-inspect") {
  const backup = await readBackup();
  await save("backup-result", backup);
  console.log(
    JSON.stringify({
      target,
      action,
      verified: true,
      bytes: backup.bytes,
      sha256: backup.sha256,
      readOnly: true,
    }),
  );
} else if (action === "apply") {
  const backup = await readBackup();
  if (
    backup.sqlSha256 !== sha256 ||
    Date.now() - Date.parse(backup.at) > 3600000
  )
    throw new Error("FRESH_BACKUP_FOR_THIS_SQL_REQUIRED");
  const before = await inspect();
  verifyGuards(backup.catalog, before);
  if (before.index || before.building)
    throw new Error("INDEX_ALREADY_PRESENT_OR_BUILDING_INSPECT_WITHOUT_RETRY");
  await save(
    "apply-attempt",
    {
      at: new Date().toISOString(),
      target,
      sha256,
      catalog: before,
      retries: 0,
    },
    true,
  );
  // Exactly one standalone statement; never concatenate BEGIN/SET to concurrent DDL.
  // On an API failure, inspect the index/progress before any retry or rollback.
  await query(sql, 45000);
  const after = await inspect();
  verifyGuards(before, after);
  if (!after.index?.valid || !after.index.ready || after.building)
    throw new Error("INDEX_NOT_VALID_OR_STILL_BUILDING_INSPECT_REQUIRED");
  await save("apply-result", {
    at: new Date().toISOString(),
    target,
    sha256,
    catalog: after,
    valid: true,
  });
  console.log(
    JSON.stringify({
      target,
      action,
      index: indexName,
      valid: true,
      ready: true,
      functionsPoliciesGrantsUnchanged: true,
      authenticatedReportsStillNeedsVerification: true,
    }),
  );
}
