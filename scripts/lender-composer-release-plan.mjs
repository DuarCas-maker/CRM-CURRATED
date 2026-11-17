// Pure release planning, shared by native PG15 verification and the installer.
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export function guardLenderMigration(sql, before) {
  const checks = before.functions
    .map(
      (f) =>
        `md5(pg_get_functiondef(${literal(f.name === "queue_mail_lenders" ? "public.queue_mail_lenders(jsonb)" : "public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid)")}::regprocedure))<>${literal(f.hash)}`,
    )
    .join(" or ");
  if (!checks || !sql.startsWith("begin;"))
    throw Error("UNRECOGNIZED_MIGRATION");
  // A replacement string would turn each $$ into $, corrupting DO delimiters.
  return sql.replace(
    /^begin;/,
    () =>
      `begin;set local search_path=pg_catalog,public,pg_temp;set local lock_timeout='5s';set local statement_timeout='30s';select pg_advisory_xact_lock(hashtextextended('lender-composer-056-release',56));do $$begin if current_database()<>'postgres' or current_user<>'supabase_admin' or to_regclass('public.lender_email_templates') is not null or ${checks} then raise exception '056_PREFLIGHT_DRIFT';end if;end $$;`,
  );
}
