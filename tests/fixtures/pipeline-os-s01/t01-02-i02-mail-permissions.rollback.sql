-- Fixture-only rollback. Operational rollback must retain the security bounds.
begin;
do $$ begin
 if current_setting('pipeline_os.i02_sandbox',true) is distinct from 'in_memory_test'
 or to_regclass('pg_temp.s01_i02_original_functions') is null then raise exception 'I02 sandbox marker and session catalog required';end if;
end $$;
do $$ declare r record;roles text;command text;begin
 for r in select * from pg_policies where schemaname in ('public','storage') loop
  execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename);
 end loop;
 for r in select * from s01_i02_original_functions loop execute r.definition;end loop;
 for r in select * from s01_i02_original_policies loop
  select string_agg(case when x='public' then 'public' else quote_ident(x) end,',') into roles from unnest(r.roles) x;
  command:=format('create policy %I on %I.%I as %s for %s to %s',r.policyname,r.schemaname,r.tablename,r.permissive,r.cmd,roles);
  if r.qual is not null then command:=command||' using ('||r.qual||')';end if;
  if r.with_check is not null then command:=command||' with check ('||r.with_check||')';end if;
  execute command;
 end loop;
end $$;
drop view public.mail_conversations_visible,public.mail_processes_visible,public.mail_archive_visible,public.mail_admin_outbox_visible;
drop function public.mail_access_context(uuid),public.mail_source_allowed(text,uuid,text),public.mail_snapshot_allowed(uuid,uuid),public.mail_document_write_allowed(uuid,uuid);
drop trigger s01_i02_scope on public.documents;
drop trigger s01_i02_scope on public.document_versions;
drop trigger s01_i02_scope on public.mail_uploads;
drop schema s01_i02 cascade;
drop index public.s01_i02_events_archive,public.s01_i02_messages_archive;
alter table public.documents drop column access_area;
alter table public.document_versions drop column access_area;
alter table public.mail_uploads drop column access_area;
revoke all on public.conversations,public.outbox from authenticated;
revoke select(id,opportunity_id,account_id) on public.conversations from authenticated;
revoke select(id,conversation_id,reply_message_id,account_id,opportunity_id,to_email,cc_emails,body,subject,status,message_id_header,gmail_message_id,created_at,sent_at,last_error,attachment_snapshot,attachment_ids,gmail_file_ids,upload_ids) on public.outbox from authenticated;
do $$ declare r record;role_name text;begin
 for r in select * from s01_i02_original_grants loop
  role_name:=case when r.grantee='PUBLIC' then 'PUBLIC' else quote_ident(r.grantee) end;
  execute 'grant '||r.privilege_type||case when r.attname is null then '' else '('||quote_ident(r.attname)||')' end||' on '||r.relation||' to '||role_name||case when r.is_grantable then ' with grant option' else '' end;
 end loop;
end $$;
drop table s01_i02_original_functions,s01_i02_original_policies,s01_i02_original_grants;
commit;
