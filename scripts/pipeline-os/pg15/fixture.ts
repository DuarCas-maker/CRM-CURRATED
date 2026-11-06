import { Bundle, demand, identifier as ident, literal as lit } from "./types";
import { prmRoot } from "./artifacts";
export const ids = {
  admin: "10000000-0000-4000-8000-000000000001",
  seller: "10000000-0000-4000-8000-000000000002",
  outsider: "10000000-0000-4000-8000-000000000003",
  closer: "10000000-0000-4000-8000-000000000004",
  account: "20000000-0000-4000-8000-000000000001",
  contact: "30000000-0000-4000-8000-000000000001",
  opportunity: "40000000-0000-4000-8000-000000000001",
  document: "50000000-0000-4000-8000-000000000001",
  knownDocument: "50000000-0000-4000-8000-000000000002",
};
export const globalsSql = `create role anon;create role authenticated;create role service_role bypassrls;
create role supabase_admin superuser;grant supabase_admin to postgres;`;
export const platformSql = `create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to authenticated,anon,service_role;grant select on storage.objects to authenticated;`;
export const ownerSql = `reset role;
do $$declare r record;begin
 for r in select format('alter %s %I.%I owner to supabase_admin',case c.relkind when 'v' then 'view' when 'S' then 'sequence' else 'table' end,n.nspname,c.relname) sql
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','v','S')
 union all select 'alter function '||p.oid::regprocedure::text||' owner to supabase_admin' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
 loop execute r.sql;end loop;end$$;set role supabase_admin;`;
export function nativeFixture(bundle: Bundle): string[] {
  const inventory = JSON.parse(
    bundle.files.get(prmRoot + "function-inventory.json")!,
  );
  demand(inventory.functions.length === 70, "QA_SERVICE_INVENTORY");
  const targets = bundle.contract.prmTargets as { key: string }[];
  const broad =
    targets
      .map((t) => {
        demand(/^public\.[a-z_]+$/.test(t.key), "QA_TARGET_KEY");
        return `grant all on table ${t.key} to anon,authenticated,service_role,postgres;`;
      })
      .join("\n") +
    "\n" +
    inventory.functions
      .map((f: { key: string }) => {
        demand(
          /^public\.[a-z0-9_]+\([a-z0-9_., \[\]]*\)$/.test(f.key),
          "QA_FUNCTION_KEY",
        );
        return `grant execute on function ${f.key} to service_role;`;
      })
      .join("\n") +
    `
alter default privileges for role supabase_admin in schema public grant all on tables to anon,authenticated,service_role,postgres;
alter default privileges for role supabase_admin in schema public grant all on functions to anon,authenticated,service_role,postgres;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon,authenticated,service_role,postgres;`;
  const seeds =
    Object.entries(ids)
      .filter(([k]) => ["admin", "seller", "outsider", "closer"].includes(k))
      .map(
        ([name, id]) =>
          `insert into auth.users values(${lit(id)},${lit(name + "@qa.test")});
insert into public.profiles(id,name,email,role) values(${lit(id)},${lit(name)},${lit(name + "@qa.test")},${lit(name === "admin" ? "superadmin" : name === "closer" ? "closer" : "seller")});`,
      )
      .join("\n") +
    `
insert into public.contacts(id,name,email,verification) values('${ids.contact}','Synthetic','lead@qa.test','valid');
insert into public.opportunities(id,contact_id,company,seller_id) values('${ids.opportunity}','${ids.contact}','Synthetic','${ids.seller}');
insert into public.mail_accounts(id,email,organization) values('${ids.account}','mail@qa.test','qa');
insert into public.documents(id,opportunity_id,name,kind,storage_path,content_hash) values('${ids.document}','${ids.opportunity}','Synthetic','qa_legacy','qa-path','qa-hash');
insert into public.financing_processes(id,opportunity_id,sequence_number,started_at,classification,label) values('70000000-0000-4000-8000-000000000001','${ids.opportunity}',1,now(),'active','Synthetic');
insert into public.gmail_archive_messages(id,account_id,gmail_message_id,gmail_thread_id,subject,sent_at,direction,nature,participants,encrypted_payload)
 values('60000000-0000-4000-8000-000000000001','${ids.account}','qa-source','qa-thread','Synthetic',now(),'inbound','personal','[]','synthetic-not-a-credential');
insert into public.gmail_attachment_choices(archive_message_id,part_id,decision,actor_id)
 values('60000000-0000-4000-8000-000000000001','qa-part','included','${ids.admin}');
insert into public.gmail_saved_attachments(id,archive_message_id,opportunity_id,process_id,part_id,name,mime_type,size,storage_path,content_hash,area,received_at)
 values('90000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','${ids.opportunity}','70000000-0000-4000-8000-000000000001','qa-part','Synthetic','application/pdf',1,'qa-source-path','${"b".repeat(64)}','seller',now());
insert into public.documents(id,opportunity_id,name,kind,storage_path,content_hash) values('${ids.knownDocument}','${ids.opportunity}','Synthetic source','qa_source','qa-source-path','${"b".repeat(64)}');
insert into public.document_versions(document_id,storage_path,content_hash,source,source_gmail_file_id) values('${ids.knownDocument}','qa-source-path','${"b".repeat(64)}','gmail','90000000-0000-4000-8000-000000000001');`;
  const prm = bundle.files.get(
    prmRoot + "final/048_restore_scoped_public_permissions.sql",
  );
  demand(prm, "QA_MISSING_048");
  return [
    platformSql,
    ...[...bundle.files.entries()]
      .filter(([p]) => p.startsWith("supabase/migrations/"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, s]) => s),
    ownerSql,
    "reset role;set role supabase_admin;" + broad,
    "reset role;set role supabase_admin;" + prm,
    "reset role;" + seeds,
  ];
}
export const identitySql = `begin read only;
select jsonb_build_object('version',current_setting('server_version_num')::integer,
'systemIdentifier',(select system_identifier::text from pg_control_system()),
'dataDirectory',current_setting('data_directory'),'database',current_database(),
'marker',shobj_description((select oid from pg_database where datname=current_database()),'pg_database'),
'pid',pg_backend_pid(),'collation',(select datcollate from pg_database where datname=current_database()),
'serverBuild',version(),'timezone',current_setting('TimeZone'),'lcCtype',(select datctype from pg_database where datname=current_database()),
'listenAddresses',current_setting('listen_addresses'),'serverAddress',inet_server_addr()::text,'port',current_setting('port')::integer,
'hbaLoopbackOnly',coalesce((select bool_and(error is null and (auth_method='reject' or
 (auth_method='scram-sha-256' and type in('host','hostssl','hostnossl') and address='127.0.0.1' and netmask='255.255.255.255'))) from pg_hba_file_rules),false)) qa_identity;
rollback;`;
export function catalogSql(bundle: Bundle) {
  const begin = bundle.migration.indexOf(
    "select snapshot into observed from (",
  );
  const end = bundle.migration.indexOf(") x;", begin);
  demand(begin > 0 && end > begin, "QA_SNAPSHOT_SOURCE");
  return bundle.migration.slice(
    begin + "select snapshot into observed from (".length,
    end,
  );
}
export function snapshotSql(bundle: Bundle, shape?: Record<string, string[]>) {
  // Rows stay inside aggregate digests; only catalog names and hashes leave PG.
  const rows = shape
    ? Object.entries(shape)
        .map(
          ([table, columns]) =>
            `select ${lit(table)} key,md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text) value from(select ${columns.map(ident).join(",")} from public.${ident(table)}) r`,
        )
        .join(" union all ")
    : null;
  return `reset role;set role supabase_admin;set search_path=pg_catalog,pg_temp;
begin read only;
select jsonb_build_object('catalog',(${catalogSql(bundle)}),
'globals',md5(jsonb_build_object('roles',(select jsonb_agg(jsonb_build_array(rolname,rolsuper,rolinherit,rolbypassrls) order by rolname) from pg_roles),
'members',(select jsonb_agg(jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),admin_option) order by roleid,member) from pg_auth_members),
'defaults',(select jsonb_agg(jsonb_build_array(pg_get_userbyid(defaclrole),defaclobjtype,defaclacl::text) order by defaclrole,defaclnamespace,defaclobjtype) from pg_default_acl))::text),
'shape',(select jsonb_object_agg(name,columns) from(select c.relname name,jsonb_agg(a.attname order by a.attnum) columns from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname='public' and c.relkind='r' group by c.relname) q),
'rows',${rows ? `(select jsonb_object_agg(key,value) from(${rows}) rows_digest)` : "null"}) qa_snapshot;
rollback;`;
}
export const seedOutbox = (
  status: "sending" | "queued" | "uncertain",
) => `reset role;set role supabase_admin;
insert into public.outbox(account_id,opportunity_id,to_email,subject,body,area,status,message_id_header,request_key)
values('${ids.account}','${ids.opportunity}','lead@qa.test','Synthetic','Synthetic','seller','${status}','<qa-${status}@qa.test>','qa-${status}');`;
export const asUser = (id: string, aal = "aal2") =>
  `reset role;select set_config('request.jwt.claims',${lit(JSON.stringify({ sub: id, aal }))},false);set role authenticated;`;
export const admin =
  "reset role;set role supabase_admin;set search_path=pg_catalog,pg_temp;";
export const captureLocks = (pid: number) => {
  demand(Number.isSafeInteger(pid) && pid > 0, "QA_BAD_PID");
  return `select jsonb_build_object('waiting',exists(select 1 from pg_stat_activity where pid=${pid} and wait_event_type='Lock'),
  'locks',coalesce((select jsonb_agg(jsonb_build_object('mode',mode,'granted',granted,'locktype',locktype)) from pg_locks where pid=${pid}),'[]')) qa_wait;`;
};
