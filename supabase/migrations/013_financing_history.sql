begin;
alter table public.gmail_saved_attachments add column reviewed_by uuid references public.profiles;
alter table public.gmail_saved_attachments add column reviewed_at timestamptz;
alter table public.financing_processes add column actual_funded_amount numeric(16,2);
alter table public.financing_processes add column funded_lender_id uuid references public.lenders;
alter table public.financing_processes add column request_key uuid unique;
alter table public.financing_processes add constraint historical_funding_evidence check(state<>'disbursed' or (actual_funded_amount is not null and actual_funded_amount>0 and funded_lender_id is not null));

create function public.gmail_record_process(process uuid,state_value text,evidence uuid,document uuid,body_text text,occurred timestamptz,actor uuid,funded_amount numeric,lender uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.financing_processes;area public.case_area;
begin
 select * into p from public.financing_processes where id=process for update;
 if p.id is null then raise exception 'Process not found'; end if;
 if evidence is null and document is null then raise exception 'Email or document evidence required'; end if;
 if evidence is not null and not exists(select 1 from public.case_events where opportunity_id=p.opportunity_id and archive_message_id=evidence) then raise exception 'Email belongs to another case'; end if;
 if document is not null and not exists(select 1 from public.documents where id=document and opportunity_id=p.opportunity_id) then raise exception 'Document belongs to another case'; end if;
 if state_value not in ('unclassified','new','contacted','waiting_customer','application_received','documents_received','prepared','submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval','disbursed','client_withdrew','funding_declined') then raise exception 'Unknown process state'; end if;
 area:=case when state_value in ('submitted','lender_evaluation','offers','lender_selected','requirements','contract_sent','contract_signed','final_approval','disbursed','funding_declined') or exists(select 1 from public.opportunities where id=p.opportunity_id and handed_off_at is not null) then 'closer'::public.case_area else 'seller'::public.case_area end;
 update public.financing_processes set state=state_value,actual_funded_amount=case when state_value='disbursed' then funded_amount else actual_funded_amount end,
 funded_lender_id=case when state_value='disbursed' then lender else funded_lender_id end where id=p.id;
 insert into public.case_events(opportunity_id,process_id,archive_message_id,document_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(p.opportunity_id,p.id,evidence,document,area,state_value,body_text,'manual',occurred,actor);
 update public.opportunities set updated_at=now() where id=p.opportunity_id;
end $$;

create function public.gmail_select_lender(process uuid,submission uuid,evidence uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.financing_processes;
begin
 select * into p from public.financing_processes where id=process for update;
 if not exists(select 1 from public.submissions where id=submission and opportunity_id=p.opportunity_id and process_id=p.id and status='offer') then raise exception 'Select an offer in this process'; end if;
 if not exists(select 1 from public.case_events where opportunity_id=p.opportunity_id and archive_message_id=evidence) then raise exception 'Selection evidence required'; end if;
 update public.submissions set status='withdrawn',withdrawal_reason='selected_other_offer' where process_id=p.id and id<>submission and status in ('draft','submitted','reviewing','requirements','offer');
 update public.offers set status=case when submission_id=submission then 'selected' else 'discarded_other_offer' end where submission_id in (select id from public.submissions where process_id=p.id) and status in ('received','selected');
 update public.financing_processes set state='lender_selected' where id=p.id;
 insert into public.case_events(opportunity_id,process_id,submission_id,archive_message_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(p.opportunity_id,p.id,submission,evidence,'closer','lender_selected','Lender selected; other alternatives withdrawn by selection, not lender rejection.','manual',now(),actor);
 update public.opportunities set updated_at=now() where id=p.opportunity_id;
end $$;
revoke all on function public.gmail_record_process(uuid,text,uuid,uuid,text,timestamptz,uuid,numeric,uuid),public.gmail_select_lender(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_record_process(uuid,text,uuid,uuid,text,timestamptz,uuid,numeric,uuid),public.gmail_select_lender(uuid,uuid,uuid,uuid) to service_role;
create function public.gmail_new_process(case_id uuid,label_text text,classification_value text,started timestamptz,request uuid,actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(case_id::text,19));
 select id into target from public.financing_processes where request_key=request and opportunity_id=case_id;
 if target is not null then return target; end if;
 insert into public.financing_processes(opportunity_id,sequence_number,started_at,classification,label,request_key)
 select case_id,coalesce(max(sequence_number),0)+1,started,classification_value,label_text,request from public.financing_processes where opportunity_id=case_id returning id into target;
 insert into public.case_events(opportunity_id,process_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(case_id,target,case when exists(select 1 from public.opportunities where id=case_id and handed_off_at is not null) then 'closer'::public.case_area else 'seller'::public.case_area end,'process_created',label_text,'manual',started,actor);
 return target;
end $$;
revoke all on function public.gmail_new_process(uuid,text,text,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_new_process(uuid,text,text,timestamptz,uuid,uuid) to service_role;
create function public.gmail_move_thread(case_id uuid,evidence uuid,process uuid,actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.gmail_archive_messages;old_process uuid;sub uuid;
begin
 if not exists(select 1 from public.financing_processes where id=process and opportunity_id=case_id and not is_unclassified_archive) then raise exception 'Choose a classified process in this case'; end if;
 select * into m from public.gmail_archive_messages where id=evidence;
 select process_id,submission_id into old_process,sub from public.gmail_thread_links where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id and opportunity_id=case_id for update;
 if old_process is null then raise exception 'Thread belongs to another case'; end if;
 if sub is not null and not exists(select 1 from public.submissions where id=sub and process_id=process) then raise exception 'Lender evaluation belongs to another process'; end if;
 update public.gmail_thread_links set process_id=process where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 update public.conversations set process_id=process where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id;
 update public.case_events set process_id=process where opportunity_id=case_id and archive_message_id in (select id from public.gmail_archive_messages where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);
 update public.gmail_saved_attachments set process_id=process where opportunity_id=case_id and archive_message_id in (select id from public.gmail_archive_messages where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);
 update public.mail_waits set process_id=process where conversation_id in(select id from public.conversations where account_id=m.account_id and gmail_thread_id=m.gmail_thread_id);
 insert into public.case_events(opportunity_id,process_id,archive_message_id,area,kind,body,evidence_type,occurred_at,actor_id)
 values(case_id,process,evidence,case when sub is null then 'seller'::public.case_area else 'closer'::public.case_area end,'process_association','Thread reassigned from process '||old_process||' to '||process,'manual',now(),actor);
end $$;
revoke all on function public.gmail_move_thread(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gmail_move_thread(uuid,uuid,uuid,uuid) to service_role;
commit;
