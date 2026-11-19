import fs from 'node:fs/promises';
import {defaultReminders} from '../../../../src/lib/campaign-sequence';
// Reproducible data-only delta; no credentials or remote operations.
const defaults=JSON.stringify(defaultReminders).replace(/'/g,"''");
const sql=`begin;
do $patch$
declare t public.email_templates;defaults jsonb:='${defaults}'::jsonb;new_body text;new_steps jsonb;
 pattern text:='(^|\\n)[ \\t]*:::signature[ \\t]*\\r?\\n.*?\\r?\\n[ \\t]*:::[ \\t]*(?=\\r?\\n|$)';
begin
 for t in select et.* from public.email_templates et where et.archived_at is null and not exists(select 1 from campaign_template_v2.revisions r where r.template_id=et.id) order by et.id for update loop
  new_body:=case when t.body_format='markdown' then btrim(regexp_replace(t.body,pattern,'\\1','gs')) else t.body end;
  select coalesce(jsonb_agg(s.value||jsonb_build_object('body',case when t.body_format='markdown' then btrim(regexp_replace(s.value->>'body',pattern,'\\1','gs')) else s.value->>'body' end) order by s.ordinality),'[]'::jsonb) into new_steps from jsonb_array_elements(t.steps) with ordinality s;
  if new_steps='[]'::jsonb then new_steps:=defaults;end if;
  if new_body is not distinct from t.body and new_steps is not distinct from t.steps then continue;end if;
  if btrim(new_body)='' or strpos(new_body,'{{unsubscribe_url}}')=0 then raise exception 'CSIG_INVALID_CONTENT';end if;
  insert into public.email_template_versions values(t.id,t.version,to_jsonb(t),now()) on conflict(template_id,version) do nothing;
  update public.email_templates set body=new_body,steps=new_steps,version=version+1,updated_at=now() where id=t.id;
  insert into public.email_template_versions select id,version,to_jsonb(et),now() from public.email_templates et where id=t.id;
  insert into campaign_template_v2.revisions values(t.id,t.version,t.version+1);
 end loop;
end $patch$;
commit;
`;
await fs.writeFile(new URL('./content.sql',import.meta.url),sql);
