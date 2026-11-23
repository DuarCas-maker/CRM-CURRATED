-- Pipeline OS load recovery. Requires explicit production approval and private definition backup.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $pre$ begin
 if not pg_try_advisory_xact_lock(hashtextextended('pipeline-os-visible-mail-recovery',0)) then
   raise exception 'MAIL_PROJECTION_RELEASE_BUSY';
 end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('s01_i02.visible_conversations()'))
   is distinct from '5aec37664aba3b60375426679e39929b' then raise exception 'MAIL_PROJECTION_SOURCE_DRIFT';end if;
 if not (select prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[]
   from pg_proc where oid='s01_i02.visible_conversations()'::regprocedure) then
   raise exception 'MAIL_PROJECTION_CONTRACT_DRIFT';
 end if;
end $pre$;
create temporary table pipeline_projection_before on commit drop as
 select to_jsonb(p)-'prosrc' as attributes from pg_proc p
 where oid='s01_i02.visible_conversations()'::regprocedure;
CREATE OR REPLACE FUNCTION s01_i02.visible_conversations()
 RETURNS TABLE(id uuid, opportunity_id uuid, submission_id uuid, account_id uuid, gmail_thread_id text, subject text, area case_area, needs_attention boolean, updated_at timestamp with time zone, process_id uuid, recipient_email text, inbox_activated_at timestamp with time zone, manually_incorporated_at timestamp with time zone, gmail_delivery_thread_id text, can_reply boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select c.id,c.opportunity_id,case when public.can_area(c.opportunity_id,'closer') then c.submission_id end,c.account_id,
 c.gmail_thread_id,case when public.can_area(c.opportunity_id,'closer') then c.subject else
 coalesce((select a.subject from public.gmail_archive_messages a where a.id=m.archive_message_id),
 (select x.subject from public.outbox x where x.message_id_header=m.internet_message_id and x.conversation_id=c.id and public.can_area(x.opportunity_id,x.area) limit 1),'Conversation') end,
 coalesce(m.area,c.area),coalesce(m.direction='inbound',false),
 m.sent_at,case when public.can_area(c.opportunity_id,'closer') then c.process_id end,
 (select p->>'email' from jsonb_array_elements(coalesce(m.participants,'[]')) p where p->>'role'='to' limit 1),
 null::timestamptz,null::timestamptz,null::text,
 public.can_edit_case(c.opportunity_id) and public.can_area(c.opportunity_id,s01_i02.phase(c.opportunity_id))
 from public.conversations c left join lateral (
 select x.* from public.messages x where x.conversation_id=c.id and public.can_area(c.opportunity_id,x.area)
 order by x.sent_at desc,x.id desc limit 1) m on true
 where s01_i02.can_conversation(c.id)
$function$;
do $post$ begin
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='s01_i02.visible_conversations()'::regprocedure)
   is distinct from (select attributes from pipeline_projection_before) then
   raise exception 'MAIL_PROJECTION_ATTRIBUTES_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid='s01_i02.visible_conversations()'::regprocedure)
   is distinct from '084a8b1c0f058da519cfbfa5e1e1f762' then raise exception 'MAIL_PROJECTION_HASH_MISMATCH';end if;
end $post$;
commit;
