begin;
create function public.freeze_queued_case_documents() returns trigger language plpgsql security definer set search_path='' as $$
declare d public.documents;items jsonb:='[]';
begin
 if coalesce(cardinality(new.attachment_ids),0)=0 then return new;end if;
 for d in select * from public.documents where id=any(new.attachment_ids) order by id for share loop
  if d.opportunity_id is distinct from new.opportunity_id or d.status<>'approved' or d.storage_path is null then raise exception 'Approved case attachments required';end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',d.id,'name',case when d.bank_name<>'' then d.bank_name||' - ' else '' end||d.name,'bucket','case-documents','storage_path',d.storage_path,'content_hash',d.content_hash));
 end loop;
 new.attachment_snapshot:=items;
 return new;
end $$;
create trigger freeze_outbox_case_documents before insert on public.outbox for each row execute function public.freeze_queued_case_documents();
-- Keep copies scoped to each lender. The selected package is shared by all
-- independent sends, and every included file must have passed human review.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.queue_mail_lenders(jsonb)'::regprocedure);
 definition:=replace(definition,' for target in select value from jsonb_array_elements(input->''targets'') loop',
 $new$ if not public.document_packet_ready(case_id) then raise exception 'Approve the application and at least four bank statements first';end if;
 if not exists(select 1 from public.documents where opportunity_id=case_id and kind='application' and status='approved' and id in(select jsonb_array_elements_text(input->'files')::uuid))
 or (select count(distinct content_hash) from public.documents where opportunity_id=case_id and kind='bank_statement' and status='approved' and id in(select jsonb_array_elements_text(input->'files')::uuid))<4 then raise exception 'Include the approved application and at least four bank statements in the package';end if;
 for target in select value from jsonb_array_elements(input->'targets') loop
  if jsonb_typeof(coalesce(target->'cc_emails','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(target->'cc_emails','[]'::jsonb))>20 then raise exception 'Invalid lender copies';end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(target->'cc_emails','[]'::jsonb)) e where not exists(select 1 from public.lender_contacts c where c.lender_id=(target->>'lender_id')::uuid and c.email=lower(btrim(e)))) then raise exception 'Copy recipients must belong to this lender';end if;
$new$);
 definition:=replace(definition,$old$'{}','{}',process,null,null,s.id$old$,$new$array(select distinct lower(btrim(e)) from jsonb_array_elements_text(coalesce(target->'cc_emails','[]'::jsonb)) e where lower(btrim(e))<>lower(target->>'email')),'{}',process,null,null,s.id$new$);
 if position('Copy recipients must belong to this lender' in definition)=0 then raise exception 'Unexpected lender queue definition';end if;
 execute definition;
 -- Older composer follows the same approval gate and permits larger bank packages.
 definition:=pg_get_functiondef('public.queue_lender_emails(uuid,uuid,uuid,jsonb,text,text,uuid[],uuid[],uuid)'::regprocedure);
 definition:=replace(definition,' for target in select value from jsonb_array_elements(targets) loop',
 $new$ if not public.document_packet_ready(case_id) then raise exception 'Approve the application and at least four bank statements first';end if;
 for target in select value from jsonb_array_elements(targets) loop$new$);
 execute definition;
 definition:=pg_get_functiondef('public.queue_manual_email(uuid,uuid,text,text,text,uuid[],uuid[],uuid)'::regprocedure);
 definition:=replace(replace(definition,'cardinality(files)>10','cardinality(files)>20'),'cardinality(gmail_files)>10','cardinality(gmail_files)>20');
 execute definition;
end $$;

-- Optional empty statement slots must not inflate or hide the missing-documents count.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.operational_dashboard(text,uuid,text,uuid,timestamptz,text,int)'::regprocedure);
 definition:=replace(definition,'count(*) filter(where required and storage_path is null) missing_count',
 'count(*) filter(where required and kind<>''bank_statement'' and storage_path is null) + greatest(0,4-count(distinct content_hash) filter(where kind=''bank_statement'' and storage_path is not null)) missing_count');
 execute definition;
end $$;
notify pgrst,'reload schema';commit;
