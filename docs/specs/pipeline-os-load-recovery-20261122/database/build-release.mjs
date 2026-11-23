import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "docs/specs/pipeline-os-load-recovery-20261122/database/";
const body = (sql) => sql.split("$function$")[1];
const md5 = (value) => createHash("md5").update(value).digest("hex");
const baseline = await readFile(root + "baseline-function.sql", "utf8");
const candidate = await readFile(root + "function.sql", "utf8");
const before = md5(body(baseline)),
  after = md5(body(candidate));
if (before !== "084a8b1c0f058da519cfbfa5e1e1f762")
  throw Error("BASELINE_DRIFT");
function render(sql, expected, next) {
  return `-- Pipeline OS load recovery. Requires explicit production approval and private definition backup.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $pre$ begin
 if not pg_try_advisory_xact_lock(hashtextextended('pipeline-os-visible-mail-recovery',0)) then
   raise exception 'MAIL_PROJECTION_RELEASE_BUSY';
 end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('s01_i02.visible_conversations()'))
   is distinct from '${expected}' then raise exception 'MAIL_PROJECTION_SOURCE_DRIFT';end if;
 if not (select prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[]
   from pg_proc where oid='s01_i02.visible_conversations()'::regprocedure) then
   raise exception 'MAIL_PROJECTION_CONTRACT_DRIFT';
 end if;
end $pre$;
create temporary table pipeline_projection_before on commit drop as
 select to_jsonb(p)-'prosrc' as attributes from pg_proc p
 where oid='s01_i02.visible_conversations()'::regprocedure;
${sql.trimEnd().replace(/;$/, "")};
do $post$ begin
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='s01_i02.visible_conversations()'::regprocedure)
   is distinct from (select attributes from pipeline_projection_before) then
   raise exception 'MAIL_PROJECTION_ATTRIBUTES_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid='s01_i02.visible_conversations()'::regprocedure)
   is distinct from '${next}' then raise exception 'MAIL_PROJECTION_HASH_MISMATCH';end if;
end $post$;
commit;
`;
}
await mkdir(root, { recursive: true });
await writeFile(
  root + "059_visible_mail_projection_performance.sql",
  render(candidate, before, after),
);
await writeFile(root + "rollback.sql", render(baseline, after, before));
await writeFile(
  root + "release-manifest.json",
  JSON.stringify(
    {
      target: "https://supabase.finlabinc.com",
      object: "s01_i02.visible_conversations()",
      before,
      after,
      migration: root + "059_visible_mail_projection_performance.sql",
      rollback: root + "rollback.sql",
      changesClientRows: false,
      changesFunctionAttributes: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ before, after, written: true }));
