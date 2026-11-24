CREATE OR REPLACE FUNCTION public.mail_human_reply(direction text, nature text, sender text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select direction='inbound' and nature='personal' and sender<>''
 and sender !~* '^(mailer-daemon|postmaster|no[._-]?reply|do[._-]?not[._-]?reply|bounce(s)?([+._-][^@]*)?)@'
$function$
;
CREATE OR REPLACE FUNCTION public.campaign_reply_rows(campaign uuid)
 RETURNS TABLE(contact_id uuid, message_id uuid, sent_at timestamp with time zone, email text, opportunity_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;
begin
 if not exists(select 1 from public.campaign_flows where campaign_id=campaign) then return query select * from campaign_flow_v1.campaign_reply_rows(campaign);return;end if;
 select * into c from brand_b2.visible_campaigns() where id=campaign;
 if public.current_app_role() is null or c.id is null or not(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())) then raise exception 'Campaign access required';end if;
 return query select distinct e.contact_id,m.id,m.sent_at,b.to_email,e.opportunity_id
 from public.campaign_enrollments e join public.outbox b on b.enrollment_id=e.id and not b.campaign_test
 join public.conversations co on co.id=b.conversation_id and co.account_id=c.account_id
 join public.messages m on m.conversation_id=co.id
 where e.campaign_id=c.id and public.can_area(e.opportunity_id,'seller') and public.can_area(co.opportunity_id,co.area)
 and b.request_key in(select 'campaign:'||e.id||':'||s from generate_series(0,4) s)
 and b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null
 and m.status='received' and public.mail_human_reply(m.direction,m.nature,m.sender)
 and lower(btrim(m.sender))=lower(btrim(b.to_email)) and m.sent_at>=b.sent_at and m.reply_intent is distinct from 'ignored'
 and (regexp_split_to_array(btrim(coalesce(m.references_header,'')),'[[:space:]]+') @> array[b.message_id_header]
  or (coalesce(btrim(m.references_header),'')='' and coalesce(co.gmail_delivery_thread_id,co.gmail_thread_id)=b.gmail_thread_id
   and not exists(select 1 from public.outbox other join public.campaign_enrollments oe on oe.id=other.enrollment_id
    where other.account_id=b.account_id and other.gmail_thread_id=b.gmail_thread_id and oe.campaign_id<>c.id and other.status='sent' and not other.campaign_test)));
end$function$
;
CREATE OR REPLACE FUNCTION campaign_flow_v1.campaign_contact_facts(campaign uuid)
 RETURNS TABLE(contact_id uuid, opportunity_id uuid, company text, name text, email text, send_status text, sent_at timestamp with time zone, reply_at timestamp with time zone, last_interaction timestamp with time zone, needs_attention boolean, conversation_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.campaigns;
begin
 select * into c from brand_b2.visible_campaigns() where id=campaign;
 if public.current_app_role() is null or c.id is null or not(public.current_app_role() in ('superadmin','seller_admin') or (public.current_app_role()='seller' and c.seller_id=auth.uid())) then raise exception 'Campaign access required';end if;
 return query
 with recipients as (
  select e.contact_id,e.opportunity_id,e.id,e.status from public.campaign_enrollments e where e.campaign_id=c.id
  union all
  select l.contact_id,l.opportunity_id,null::uuid,'selected'::text from public.leads l where c.first_contact and l.contact_id=any(c.selected_contact_ids)
  and not exists(select 1 from public.campaign_enrollments e where e.campaign_id=c.id and e.contact_id=l.contact_id)
 ), replies as materialized(select rp.contact_id,max(rp.sent_at) at from public.campaign_reply_rows(c.id) rp group by rp.contact_id)
 select ct.id,r.opportunity_id,coalesce(op.company,l.company,''),ct.name,ct.email,
 case when b.status='sent' and b.gmail_message_id is not null and b.sent_at is not null then 'sent'
 when b.status='sent' then 'uncertain'
 when b.status is not null then b.status
 when ct.id=any(c.excluded_contact_ids) or exists(select 1 from public.suppressions s where s.email=ct.email) or ct.verification<>'valid' then 'blocked'
 when c.first_contact and (op.id is null or op.stage not in ('new','contacting') or op.application_complete or op.handed_off_at is not null or op.archived_at is not null) then 'blocked'
 when r.status in ('suppressed','bounced','goal_met') then r.status else 'pending' end,
 case when b.status='sent' and b.gmail_message_id is not null then b.sent_at end,reply.at,
 greatest(b.sent_at,reply.at,co.updated_at),coalesce(reply.at is not null and co.needs_attention
  and reply.at >= coalesce((select max(latest.sent_at) from public.messages latest where latest.conversation_id=co.id
   and public.mail_human_reply(latest.direction,latest.nature,latest.sender) and lower(btrim(latest.sender))=lower(btrim(b.to_email)) and latest.reply_intent is distinct from 'ignored'),reply.at)
  and reply.at >= coalesce((select max(latest.sent_at) from public.messages latest where latest.conversation_id=co.id and latest.direction='outbound' and latest.status='sent'),reply.at),false),co.id
 from recipients r join public.contacts ct on ct.id=r.contact_id
 left join public.opportunities op on op.id=r.opportunity_id left join public.leads l on l.contact_id=ct.id
 left join lateral(select x.* from public.outbox x where x.enrollment_id=r.id and not x.campaign_test
  and (x.request_key='campaign:'||r.id::text||':0' or x.message_id_header='<'||r.id::text||'.0@crm.curated.local>') order by x.created_at,x.id limit 1) b on true
 left join public.conversations co on co.id=b.conversation_id and co.account_id=c.account_id and public.can_area(co.opportunity_id,co.area)
 left join replies reply on reply.contact_id=ct.id
 where (r.opportunity_id is not null and public.can_area(r.opportunity_id,'seller'))
 or (r.opportunity_id is null and l.id is not null and public.can_lead(l.id));
end $function$
;
CREATE OR REPLACE FUNCTION public.campaign_contact_facts(campaign uuid)
 RETURNS TABLE(contact_id uuid, opportunity_id uuid, company text, name text, email text, send_status text, sent_at timestamp with time zone, reply_at timestamp with time zone, last_interaction timestamp with time zone, needs_attention boolean, conversation_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.campaign_flows where campaign_id=campaign) then return query select * from campaign_flow_v1.campaign_contact_facts(campaign);return;end if;
 return query with replies as materialized(
  select distinct on(r.contact_id) r.contact_id,r.sent_at,co.id,co.updated_at,co.needs_attention and r.sent_at>=coalesce((select max(x.sent_at) from public.messages x where x.conversation_id=co.id and x.direction='outbound' and x.status='sent'),r.sent_at) attention
  from public.campaign_reply_rows(campaign) r join public.messages m on m.id=r.message_id join public.conversations co on co.id=m.conversation_id
  where public.can_area(co.opportunity_id,co.area) order by r.contact_id,r.sent_at desc,r.message_id
 ) select f.contact_id,f.opportunity_id,f.company,f.name,f.email,f.send_status,f.sent_at,f.reply_at,greatest(f.last_interaction,r.updated_at),coalesce(r.attention,f.needs_attention),coalesce(r.id,f.conversation_id)
 from campaign_flow_v1.campaign_contact_facts(campaign) f left join replies r on r.contact_id=f.contact_id;
end$function$
;
