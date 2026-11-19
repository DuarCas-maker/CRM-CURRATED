import fs from "node:fs/promises";
const id = process.argv[2];
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id || ""))
  throw Error("ATTEMPT_ID_REQUIRED");
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
const sql = `begin read only;set local statement_timeout='10s';set local lock_timeout='1s';select r.provider,r.state,r.identity_saved,r.exchange_started,r.deadline<clock_timestamp() expired,r.error, r.account_id is not null account_registered,exists(select 1 from public.mail_credentials c where c.account_id=r.account_id) credential_present,exists(select 1 from public.profiles p where p.id=r.actor_id and p.active) actor_active,exists(select 1 from public.profiles p where p.id=r.advisor_id and p.active) advisor_active from simple_mail.onboarding r where r.id='${id}'::uuid;rollback;`;
const response = await fetch(new URL("/pg/query", origin), {
  method: "POST",
  headers: { apikey: key, "content-type": "application/json" },
  body: JSON.stringify({ query: sql }),
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
const data = await response.json().catch(() => null);
if (!response.ok || !Array.isArray(data) || data.length > 1)
  throw Error("METADATA_READ_UNPROVEN");
const result = {
  at: new Date().toISOString(),
  readOnly: true,
  found: data.length === 1,
  metadata: data[0] ?? null,
  credentialValuesRead: false,
  providerCalls: 0,
  remoteChanges: 0,
};
await fs.writeFile(
  new URL("attempt-metadata.private.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
