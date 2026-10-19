-- Removes only the new read contract and its new transition history.
-- Export process_state_history before rollback if its audit records are needed.
begin;
drop function public.financing_control_dashboard(text,uuid,text,uuid,timestamptz,text,int,text,int);
drop trigger process_state_transition on public.financing_processes;
drop function public.track_process_state();
drop table public.process_state_history;
drop index public.dashboard_process_scope;
drop index public.dashboard_confirmed_sends;
drop index public.dashboard_case_documents;
drop index public.dashboard_submission_messages;
notify pgrst,'reload schema';
commit;
