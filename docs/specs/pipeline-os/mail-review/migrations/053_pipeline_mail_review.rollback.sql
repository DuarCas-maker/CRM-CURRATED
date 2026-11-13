-- Local rollback candidate: export review evidence before an authorized remote rollback.
begin;
drop function public.pipeline_mail_approve(uuid,int,uuid,jsonb);
drop function public.pipeline_mail_finish(uuid,uuid,jsonb,text);
drop function public.pipeline_mail_begin(uuid,uuid,uuid,uuid,boolean,int);
drop function public.pipeline_mail_page(uuid,uuid);
drop function public.pipeline_mail_source(uuid,uuid,uuid);
drop table public.pipeline_mail_requirements;
drop table public.pipeline_mail_review_attempts;
drop table public.pipeline_mail_reviews;
notify pgrst,'reload schema';
commit;
