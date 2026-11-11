// Offline source preparation. Writes only the local candidate, never executes SQL.
import { readFileSync, writeFileSync } from "node:fs";
const root = "docs/specs/pipeline-os/s02/";
const read = (p) => readFileSync(root + p, "utf8").replaceAll("\r\n", "\n");
const base = read("transport-selection/migrations/r06.local.sql");
const fn = (source, name) => {
  const a = source.indexOf("create function " + name + "(");
  if (a < 0) throw Error(name);
  const b = source.indexOf("end$$;", a);
  if (b < 0) throw Error(name);
  return source.slice(a, b + 7);
};
let command = fn(base, "public.mail_transport_command").replace(
  "create function",
  "create or replace function",
);
const replace = (source, a, b) => {
  if (source.split(a).length !== 2) throw Error("I04 anchor " + a);
  return source.replace(a, b);
};
command = replace(
  command,
  "v_approval jsonb;",
  "v_approval jsonb;cfg2 mail_quota.binding_contexts;c2 mail_quota.binding_checks;",
);
command = replace(
  command,
  "human jsonb:=composio_connect.human();",
  "human jsonb:=mail_quota.human();",
);
command = replace(
  command,
  "select * into cfg from composio_connect.configuration where id=1;",
  `if b.quota_contract_version=2 then
  if p->>'target_provider'='composio' and kind in('prepare_transition','commit_transition') then cfg2:=mail_quota.binding_config(account);
  else select * into cfg2 from mail_quota.binding_contexts where account_id=account;end if;
  cfg.generation:=cfg2.generation;cfg.project_id:=cfg2.context->>'composio_project_id';cfg.auth_config_id:=cfg2.auth_config_id;
 else select * into cfg from composio_connect.configuration where id=1;end if;`,
);
command = replace(
  command,
  "  if exists(select 1 from mail_runtime.attempts",
  "  if exists(select 1 from mail_runtime.sync_cycles where account_id=account and state in('active','uncertain')) or exists(select 1 from mail_runtime.attempts",
);
const a = command.indexOf(
    "   select * into c from public.mail_provider_binding_checks",
  ),
  b = command.indexOf(
    "   update mail_runtime.routes set provider='composio'",
    a,
  );
if (a < 0 || b < a) throw Error("commit branch");
command =
  command.slice(0, a) +
  `   if b.quota_contract_version<>2 then raise exception 'R06_EVIDENCE_REQUIRED';end if;
   select * into c2 from mail_quota.binding_checks x where x.binding_id=b.id and x.status='completed' and x.confirmed_at is not null order by x.started_at desc,x.id limit 1 for update;
   if c2.id is null or c2.actor_id<>actor or c2.session_id<>(human->>'session')::uuid or c2.valid_until<=clock_timestamp() or c2.deadline<=clock_timestamp()
    or not mail_quota.binding_confirmed(b,ctx) then raise exception 'R06_EVIDENCE_REQUIRED';end if;
   post_ctx:=ctx;
   v_approval:=jsonb_build_object('contract_version',2,'pre_context',b.account_context,'post_context',ctx,'post_epoch',r.account_epoch,
    'head_revision',h.revision,'binding_revision',b.revision,'check_id',c2.id,'actor_id',actor,'actor_revision',c2.actor_revision,
    'verification_context_hash',cfg2.digest,'config_generation',cfg2.generation);
` +
  command.slice(b);
// Explicit v2 dispatch; v1 delegates to the untouched private copy.
command = replace(
  command,
  " ctx:=mail_runtime.context(account);",
  ` ctx:=mail_runtime.context(account);
 if not exists(select 1 from public.mail_provider_binding_heads bh join public.mail_provider_bindings bb on bb.id=bh.current_binding_id where bh.account_id=account and bb.quota_contract_version=2) then
  return mail_runtime.command_v1(account,kind,p,request_key);end if;`,
);
const privateCopy = (signature, name) => `do $copy$ declare d text;begin
 select pg_get_functiondef('${signature}'::regprocedure) into d;
 d:=replace(d,'CREATE OR REPLACE FUNCTION '||split_part('${signature}','(',1)||'(', 'CREATE OR REPLACE FUNCTION ${name}(');
 execute d;end $copy$;\n`;
let out = read("quota-policy-reuse/migrations/quota-i04.local.sql");
const mark = "-- I04-R generated offline from sealed v1 declarations.";
out = out.split(mark)[0].replace(/commit;\s*$/, "");
out +=
  mark +
  "\n" +
  read("quota-policy-reuse/migrations/quota-i04-runtime.body.sql");
out += privateCopy(
  "public.mail_transport_command(uuid,text,jsonb,uuid)",
  "mail_runtime.command_v1",
);
out += privateCopy(
  "mail_runtime.binding_approved(public.mail_provider_bindings,jsonb)",
  "mail_runtime.binding_approved_v1",
);
out += privateCopy(
  "composio_c1.approval_current(public.mail_provider_bindings,jsonb)",
  "mail_runtime.approval_current_v1",
);
out += privateCopy(
  "mail_runtime.ticket(mail_runtime.attempts)",
  "mail_runtime.ticket_v1",
);
out += privateCopy(
  "public.mail_transport_snapshot(uuid)",
  "mail_runtime.snapshot_v1",
);
out += privateCopy(
  "public.mail_transport_validate_context(uuid,text,text,bigint,boolean)",
  "mail_runtime.validate_context_v1",
);
out += privateCopy(
  "public.mail_transport_review(uuid)",
  "mail_runtime.review_v1",
);
let review = fn(
  read("transport-selection/migrations/r06-i03.local.sql"),
  "public.mail_transport_review",
);
review = replace(
  review,
  "public.mail_transport_review(",
  "mail_runtime.review_v2(",
);
review = replace(
  review,
  "perform composio_connect.human();",
  "perform mail_quota.human();",
);
out += review + "\n";
out +=
  command +
  "\n" +
  read("quota-policy-reuse/migrations/quota-i04-runtime.wrappers.sql");
out +=
  "\nrevoke all on all functions in schema mail_runtime from public,anon,authenticated,service_role;\ncommit;\n";
writeFileSync(root + "quota-policy-reuse/migrations/quota-i04.local.sql", out);
