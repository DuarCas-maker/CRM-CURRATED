import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("./", import.meta.url);
const expected =
  "8fc57667383daad1459c68293e6854a4298bd67b3f05efeede58b01a4c985d18";
if (!process.argv.includes("--authorized-gmail-direct-no-backup"))
  throw Error("EXPLICIT_RELEASE_MODE_REQUIRED");
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
if (
  origin.protocol !== "https:" ||
  origin.hostname !== "supabase.finlabinc.com" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  !["", "8000"].includes(origin.port)
)
  throw Error("TARGET_MISMATCH");
origin.port = "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw Error("EXISTING_CONNECTION_REQUIRED");
const sql = await fs.readFile(
  new URL("058_simple_mail_connections.sql", root),
  "utf8",
);
if (createHash("sha256").update(sql).digest("hex") !== expected)
  throw Error("PAYLOAD_HASH_MISMATCH");
const query = async (text) => {
  const response = await fetch(new URL("/pg/query", origin), {
    method: "POST",
    redirect: "error",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ query: text }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) {
    console.log(
      JSON.stringify({
        http: response.status,
        error:
          typeof data?.message === "string"
            ? data.message.slice(0, 250)
            : "SQL_RESPONSE_UNPROVEN",
      }),
    );
    throw Error("SQL_RESPONSE_UNPROVEN");
  }
  return data;
};
const pre = await query(
  "begin read only;set local statement_timeout='10s';select current_database() db,current_user role,to_regnamespace('simple_mail') is not null installed,md5(replace(prosrc,E'\\r\\n',E'\\n')) guard from pg_proc where oid='mail_runtime.command_v1(uuid,text,jsonb,uuid)'::regprocedure;rollback;",
);
if (
  pre.length !== 1 ||
  pre[0].db !== "postgres" ||
  !["supabase_admin", "postgres"].includes(pre[0].role) ||
  pre[0].installed ||
  pre[0].guard !== "c2c3178219832b68d64bb85d22e39276"
)
  throw Error("LIVE_BASE_DRIFT_OR_ALREADY_APPLIED");
let receipt = {
  at: new Date().toISOString(),
  origin: origin.origin,
  sqlSha256: expected,
  backup: { created: false, explicitlyWaivedByUser: true },
  preflight: pre[0],
  applied: false,
  postflightVerified: false,
};
await fs.writeFile(
  new URL("sql-application.json", root),
  JSON.stringify(receipt, null, 2) + "\n",
);
await query(sql);
receipt.applied = true;
await fs.writeFile(
  new URL("sql-application.json", root),
  JSON.stringify(receipt, null, 2) + "\n",
);
const post = await query(
  "begin read only;set local statement_timeout='10s';select jsonb_build_object('schema',to_regnamespace('simple_mail') is not null,'onboardings',(select count(*) from simple_mail.onboarding),'health',(select count(*) from simple_mail.health),'included',(select count(*) from simple_mail.included),'usage',(select count(*) from simple_mail.usage),'saved_function_sources',(select count(*) from simple_mail.function_sources),'public_functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'simple\\_mail\\_%' escape '\\'),'anon_executable',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'simple\\_mail\\_%' escape '\\' and has_function_privilege('anon',p.oid,'EXECUTE')),'human_options',has_function_privilege('authenticated','public.simple_mail_options()','EXECUTE'),'private_denied',not has_function_privilege('authenticated','public.simple_mail_private(uuid)','EXECUTE'),'new_qualifier',(select strpos(prosrc,'command_v1.request_key')>0 and strpos(prosrc,'mail_transport_command.request_key')=0 from pg_proc where oid='mail_runtime.command_v1(uuid,text,jsonb,uuid)'::regprocedure)) result;rollback;",
);
const r = post[0]?.result;
receipt.postflight = r;
receipt.postflightVerified =
  !!r?.schema &&
  r.onboardings === 0 &&
  r.health === 0 &&
  r.included === 0 &&
  r.usage === 0 &&
  r.saved_function_sources === 1 &&
  r.public_functions > 20 &&
  r.anon_executable === 0 &&
  r.human_options &&
  r.private_denied &&
  r.new_qualifier;
await fs.writeFile(
  new URL("sql-application.json", root),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt));
if (!receipt.postflightVerified)
  throw Error("POSTFLIGHT_NOT_PROVEN_DO_NOT_REAPPLY");
