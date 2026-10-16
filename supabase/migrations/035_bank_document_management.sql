begin;
-- A single transaction moves/reorders statements while preserving file reviews.
create function public.move_bank_documents(p jsonb, request_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); case_id uuid:=(p->>'opportunity_id')::uuid;
 bank text:=btrim(coalesce(p->>'bank_name','')); ids uuid[]; destination uuid[];
 affected text[]; current_bank text; ordered uuid[]; position int:=(p->>'position')::int;
 snapshot jsonb; plan jsonb:='[]'; receipt public.command_receipts; result jsonb; i int; item uuid;
begin
 if actor is null or public.current_app_role() is null then raise exception 'Invitation and MFA required'; end if;
 if request_key is null then raise exception 'Idempotency key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||request_key::text,0));
 perform 1 from public.opportunities where id=case_id for update;
 if not public.can_edit_case(case_id) then raise exception 'Case is inaccessible or read-only'; end if;
 select * into receipt from public.command_receipts r where r.user_id=actor and r.request_key=move_bank_documents.request_key;
 if found then
  if receipt.kind<>'move_bank_documents' or receipt.fingerprint<>md5(p::text) then raise exception 'Idempotency key reused with different input'; end if;
  return receipt.result;
 end if;
 if bank='' or length(bank)>120 then raise exception 'Bank name required (maximum 120 characters)'; end if;
 select array_agg(value::uuid order by ordinal) into ids from jsonb_array_elements_text(p->'document_ids') with ordinality t(value,ordinal);
 if coalesce(cardinality(ids),0)=0 or cardinality(ids)>200 or cardinality(ids)<>(select count(distinct v) from unnest(ids) v) then raise exception 'Select distinct bank statements (maximum 200)'; end if;
 perform 1 from public.documents where opportunity_id=case_id and kind='bank_statement' order by id for update;
 if (select count(*) from public.documents where opportunity_id=case_id and kind='bank_statement' and id=any(ids))<>cardinality(ids) then raise exception 'Bank statements must belong to this opportunity'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'bank_name',bank_name,'statement_number',statement_number)),'[]') into snapshot from public.documents where opportunity_id=case_id and kind='bank_statement';
 if jsonb_typeof(p->'expected_documents') is distinct from 'array' then raise exception 'Reload documents before moving'; end if;
 if jsonb_array_length(p->'expected_documents')<>jsonb_array_length(snapshot) or not snapshot @> (p->'expected_documents') or not (p->'expected_documents') @> snapshot then raise exception 'Documents changed; reload before moving'; end if;
 select coalesce((select d.bank_name from public.documents d where d.opportunity_id=case_id and d.kind='bank_statement' and lower(btrim(d.bank_name))=lower(bank) order by created_at,id limit 1),bank) into bank;
 select array_agg(id order by statement_number nulls last,created_at,id) into destination from public.documents where opportunity_id=case_id and kind='bank_statement' and lower(btrim(bank_name))=lower(bank) and not(id=any(ids));
 destination:=coalesce(destination,'{}');
 if position is null or position<1 or position>cardinality(destination)+1 then raise exception 'Invalid statement position'; end if;
 select array_agg(distinct b) into affected from (select lower(btrim(bank_name)) b from public.documents where id=any(ids) union select lower(bank)) banks;
 foreach current_bank in array affected loop
  if current_bank=lower(bank) then
   ordered:=coalesce(destination[1:position-1],'{}')||ids||coalesce(destination[position:cardinality(destination)],'{}');
  else
   select array_agg(id order by statement_number nulls last,created_at,id) into ordered from public.documents where opportunity_id=case_id and kind='bank_statement' and lower(btrim(bank_name))=current_bank and not(id=any(ids));
  end if;
  i:=0;
  foreach item in array coalesce(ordered,'{}') loop
   i:=i+1;
   plan:=plan||jsonb_build_array(jsonb_build_object('id',item,'bank_name',case when current_bank=lower(bank) then bank else (select d.bank_name from public.documents d where d.id=item) end,'statement_number',i));
  end loop;
 end loop;
 -- NULL staging avoids collisions with the immediate unique index during swaps.
 update public.documents set statement_number=null where opportunity_id=case_id and kind='bank_statement' and lower(btrim(bank_name))=any(affected);
 update public.documents d set bank_name=x.bank_name,statement_number=x.statement_number,name='Bank Statement '||x.statement_number
 from jsonb_to_recordset(plan) x(id uuid,bank_name text,statement_number int) where d.id=x.id;
 insert into public.audit_log(actor_id,entity_type,entity_id,action,metadata) values(actor,'opportunity',case_id,'move_bank_documents',jsonb_build_object('before',snapshot,'after',plan,'document_ids',ids));
 result:=jsonb_build_object('opportunity_id',case_id,'document_ids',ids);
 insert into public.command_receipts(user_id,request_key,kind,result,fingerprint) values(actor,request_key,'move_bank_documents',result,md5(p::text));
 return result;
end $$;
revoke all on function public.move_bank_documents(jsonb,uuid) from public,anon;
grant execute on function public.move_bank_documents(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
