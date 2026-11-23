// Plan is offline. --execute requires explicit permission for this diagnostic.
// Reads schema metadata only, with a read-only transaction and bounded timeout.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const target = "https://supabase.finlabinc.com";
const queries = [
  {
    name: "identity",
    sql: `select current_database() as database,
    current_setting('server_version_num') as version,
    to_regclass('public.mail_conversations_visible') is not null as visible_mail,
    to_regnamespace('s01_i02') is not null as mail_schema`,
  },
  {
    name: "mail_definitions",
    sql: `select n.nspname as schema,p.proname as name,
    pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef as security_definer,
    p.provolatile as volatility, p.proconfig as configuration,
    md5(p.prosrc) as source_hash, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='s01_i02' and p.proname in
      ('visible_conversations','can_conversation','can_message','can_archive','phase',
       'visible_phase','actor_can_read','actor_can_write'))
      or (n.nspname='public' and p.proname in
       ('can_area','can_case','can_edit_case','current_app_role'))`,
  },
  {
    name: "mail_view",
    sql: `select c.relname as name,c.reloptions as options,
    c.relacl::text as grants,pg_get_viewdef(c.oid,true) as definition
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='mail_conversations_visible'`,
  },
  {
    name: "indexes_and_volume",
    sql: `select s.relname as relation,
    s.n_live_tup as approximate_rows, s.last_analyze, s.last_autoanalyze,
    (select coalesce(jsonb_agg(jsonb_build_object('name',i.indexname,
      'definition',i.indexdef)),'[]'::jsonb) from pg_indexes i
      where i.schemaname='public' and i.tablename=s.relname) as indexes
    from pg_stat_user_tables s where s.schemaname='public' and s.relname in
      ('conversations','messages','gmail_archive_messages','outbox','opportunities',
       'profiles','mail_permissions','case_events')`,
  },
  {
    name: "mail_policies",
    sql: `select schemaname,tablename,policyname,permissive,
    roles,cmd,qual,with_check from pg_policies where schemaname='public'
    and tablename in ('conversations','messages','gmail_archive_messages','outbox')`,
  },
  {
    name: "filter_plan",
    sql: `explain (format json) select id,opportunity_id
    from public.mail_conversations_visible
    where opportunity_id='00000000-0000-0000-0000-000000000000'::uuid
    order by id limit 50`,
  },
];
if (!process.argv.includes("--execute")) {
  console.log(
    JSON.stringify(
      {
        target,
        mode: "plan",
        writes: false,
        readsClientRows: false,
        queries: queries.map((q) => ({
          ...q,
          sql: `begin read only; set local statement_timeout='5s'; ${q.sql}; rollback;`,
        })),
      },
      null,
      2,
    ),
  );
} else {
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (
    origin.origin !== target ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("DIAGNOSTIC_TARGET_MISMATCH");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("DIAGNOSTIC_CREDENTIAL_UNAVAILABLE");
  const observations = [];
  for (const query of queries) {
    const start = performance.now();
    const response = await fetch(new URL("/pg/query", origin), {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({
        query: `begin read only; set local statement_timeout='5s'; ${query.sql}; rollback;`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error("DIAGNOSTIC_HTTP_" + response.status);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("DIAGNOSTIC_RESPONSE_INVALID");
    if (
      query.name === "identity" &&
      !rows.some(
        (r) =>
          r.database === "postgres" &&
          r.visible_mail === true &&
          r.mail_schema === true,
      )
    )
      throw new Error("DIAGNOSTIC_DATABASE_MISMATCH");
    observations.push({
      name: query.name,
      duration_ms: Math.round(performance.now() - start),
      rows,
    });
  }
  const directory = resolve(
    ".local/pipeline-os-load-recovery-20261122/database",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "metadata.json"),
    JSON.stringify(observations, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        target,
        mode: "read_only",
        writes: false,
        readsClientRows: false,
        file: resolve(directory, "metadata.json"),
        checks: observations.map((o) => ({
          name: o.name,
          duration_ms: o.duration_ms,
          count: o.rows.length,
        })),
      },
      null,
      2,
    ),
  );
}
