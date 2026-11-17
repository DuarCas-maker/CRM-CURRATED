-- Supabase production default privileges can pre-grant table DML to API roles.
-- Narrow only the new library tables; keep RLS and the administrative RPC.
begin;
revoke all on public.lender_email_templates,public.lender_email_template_versions from public,anon,authenticated;
grant select on public.lender_email_templates,public.lender_email_template_versions to authenticated;
grant all on public.lender_email_templates,public.lender_email_template_versions to service_role;
notify pgrst,'reload schema';
commit;
