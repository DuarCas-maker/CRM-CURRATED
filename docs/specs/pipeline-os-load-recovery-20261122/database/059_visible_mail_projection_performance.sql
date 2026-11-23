-- Pipeline OS load recovery. Requires explicit production approval and private definition backup.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $pre$ begin
 if not pg_try_advisory_xact_lock(hashtextextended('pipeline-os-visible-mail-recovery',0)) then
   raise exception 'MAIL_PROJECTION_RELEASE_BUSY';
 end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('s01_i02.visible_conversations()'))
   is distinct from '084a8b1c0f058da519cfbfa5e1e1f762' then raise exception 'MAIL_PROJECTION_SOURCE_DRIFT';end if;
 if not (select prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[]
   from pg_proc where oid='s01_i02.visible_conversations()'::regprocedure) then
   raise exception 'MAIL_PROJECTION_CONTRACT_DRIFT';
 end if;
end $pre$;
create temporary table pipeline_projection_before on commit drop as
 select to_jsonb(p)-'prosrc' as attributes from pg_proc p
 where oid='s01_i02.visible_conversations()'::regprocedure;
-- Candidate: same signature, owner, grants and security context as the existing function.
create or replace function s01_i02.visible_conversations() returns table(
 id uuid,opportunity_id uuid,submission_id uuid,account_id uuid,gmail_thread_id text,
 subject text,area public.case_area,needs_attention boolean,updated_at timestamptz,
 process_id uuid,recipient_email text,inbox_activated_at timestamptz,
 manually_incorporated_at timestamptz,gmail_delivery_thread_id text,can_reply boolean)
language sql stable security definer set search_path='' as $function$
 with case_ids as materialized (
   select distinct c.opportunity_id from public.conversations c
 ), permissions as materialized (
   select i.opportunity_id,
     public.can_case(i.opportunity_id) as case_allowed,
     public.can_area(i.opportunity_id,'general') as general_allowed,
     public.can_area(i.opportunity_id,'seller') as seller_allowed,
     public.can_area(i.opportunity_id,'closer') as closer_allowed,
     public.can_edit_case(i.opportunity_id)
       and public.can_area(i.opportunity_id,s01_i02.phase(i.opportunity_id)) as reply_allowed
   from case_ids i
 )
 select c.id,c.opportunity_id,
   case when p.closer_allowed then c.submission_id end,c.account_id,c.gmail_thread_id,
   case when p.closer_allowed then c.subject else
     coalesce((select a.subject from public.gmail_archive_messages a where a.id=m.archive_message_id),
       (select x.subject from public.outbox x where x.message_id_header=m.internet_message_id
         and x.conversation_id=c.id and public.can_area(x.opportunity_id,x.area) limit 1),
       'Conversation') end,
   coalesce(m.area,c.area),coalesce(m.direction='inbound',false),m.sent_at,
   case when p.closer_allowed then c.process_id end,
   (select participant->>'email' from jsonb_array_elements(coalesce(m.participants,'[]')) participant
     where participant->>'role'='to' limit 1),
   null::timestamptz,null::timestamptz,null::text,p.reply_allowed
 from public.conversations c
 join permissions p on p.opportunity_id=c.opportunity_id and p.case_allowed
 left join lateral (
   select x.* from public.messages x where x.conversation_id=c.id and
     case x.area when 'general' then p.general_allowed
       when 'seller' then p.seller_allowed when 'closer' then p.closer_allowed end
   order by x.sent_at desc,x.id desc limit 1
 ) m on true
 where m.id is not null or (
   not exists(select 1 from public.messages x where x.conversation_id=c.id)
   and case c.area when 'general' then p.general_allowed
     when 'seller' then p.seller_allowed when 'closer' then p.closer_allowed end
 )
$function$;
do $post$ begin
 if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='s01_i02.visible_conversations()'::regprocedure)
   is distinct from (select attributes from pipeline_projection_before) then
   raise exception 'MAIL_PROJECTION_ATTRIBUTES_CHANGED';end if;
 if (select md5(prosrc) from pg_proc where oid='s01_i02.visible_conversations()'::regprocedure)
   is distinct from '5aec37664aba3b60375426679e39929b' then raise exception 'MAIL_PROJECTION_HASH_MISMATCH';end if;
end $post$;
commit;
