// Diagnostic only. Default --plan does not load credentials or contact the server.
// --execute needs separate permission to reuse the existing local environment.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const target = "https://supabase.finlabinc.com";
const queries = [
  { name: "identity", sql: `begin read only; set local statement_timeout='5s';
    select current_database() as database, current_user as actor,
      current_setting('server_version_num') as version,
      to_regclass('public.opportunities') is not null as opportunities,
      to_regclass('public.profiles') is not null as profiles;
    rollback;` },
  { name: "statistics_functions", sql: `begin read only; set local statement_timeout='5s';
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments,
      md5(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),E'\\r',E'\\n')) as source_hash,
      not p.prosecdef as security_invoker, p.provolatile as volatility,
      pg_get_userbyid(p.proowner) as owner, p.proconfig as configuration,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('workspace_stats','workspace_stats_base');
    rollback;` },
  { name: "indexes_and_volume", sql: `begin read only; set local statement_timeout='5s';
    select s.relname as relation, s.n_live_tup as approximate_rows,
      (select coalesce(jsonb_agg(jsonb_build_object('name',i.indexname,'definition',i.indexdef)),'[]'::jsonb)
       from pg_indexes i where i.schemaname='public' and i.tablename=s.relname) as indexes
    from pg_stat_user_tables s where s.schemaname='public' and s.relname in
      ('opportunities','contacts','conversations','messages','import_rows','stage_history','tasks','offers');
    rollback;` },
];
if (!process.argv.includes("--execute")) {
  console.log(JSON.stringify({ target, mode: "plan", statements: queries.map(q=>({ name:q.name,sql:q.sql })), writes:false,readsClientRows:false },null,2));
} else {
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (origin.origin !== target || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("DIAGNOSTIC_TARGET_MISMATCH");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("DIAGNOSTIC_CREDENTIAL_UNAVAILABLE");
  const observations = [];
  for (const query of queries) {
    const started = performance.now();
    const response = await fetch(new URL("/pg/query",origin),{
      method:"POST",headers:{apikey:key,"content-type":"application/json"},
      body:JSON.stringify({query:query.sql}),redirect:"error",signal:AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error("DIAGNOSTIC_HTTP_"+response.status);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("DIAGNOSTIC_RESPONSE_INVALID");
    if (query.name === "identity" && !rows.some(r=>r.database==='postgres' && r.opportunities===true && r.profiles===true)) throw new Error("DIAGNOSTIC_DATABASE_MISMATCH");
    observations.push({ name:query.name,duration_ms:Math.round(performance.now()-started),rows });
  }
  const directory=resolve('.local/application-performance-20261118/sql-diagnosis');
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'metadata.json'),JSON.stringify(observations,null,2)+'\n');
  // Print hashes and booleans only, never credentials, function bodies or client rows.
  console.log(JSON.stringify({target,mode:'read_only',file:resolve(directory,'metadata.json'),checks:observations.map(o=>({name:o.name,duration_ms:o.duration_ms,count:o.rows.length})),functions:observations.find(o=>o.name==='statistics_functions')?.rows.map(({name,source_hash,security_invoker})=>({name,source_hash,security_invoker})),writes:false,readsClientRows:false},null,2));
}
