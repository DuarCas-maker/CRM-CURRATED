import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {db,checked} from "./db";
import {decrypt} from "../src/lib/server/crypto";
import {parseBounceReport, type BounceReport} from "../src/lib/mail-bounce";
import type {MailSnapshot} from "../src/lib/gmail-history";

type Candidate={account:string;notice:string;thread:string;occurred:string;report:BounceReport};
const planPath="/tmp/crm-bounce-reconciliation.json";
/** Explicit maintenance entrypoint, never imported by the worker scheduler.
 * Prepare reads existing encrypted archives only. Apply consumes that exact
 * private plan; neither phase calls Gmail/Bouncer or starts the sender loop. */
export async function reconcileArchivedBounces(mode:"prepare"|"apply") {
 const client=db();
 if(mode==="apply") {
  const plan=JSON.parse(await readFile(planPath,"utf8")) as {createdAt:string;candidates:Candidate[]};
  if(Date.now()-Date.parse(plan.createdAt)>3600000)throw new Error("BOUNCE_PLAN_EXPIRED");
  let matched=0,duplicates=0,cancelled=0,stopped=0;
  for(const c of plan.candidates) {
   const r=checked(await client.rpc("record_mail_bounce",{...c,dry_run:false})) as {matched:boolean;duplicate?:boolean;cancelled?:number;stopped?:number};
   if(!r.matched)continue;matched++;duplicates+=Number(!!r.duplicate);cancelled+=r.cancelled||0;stopped+=r.stopped||0;
  }
  return {phase:mode,candidates:plan.candidates.length,matched,duplicates,cancelled,stopped,providerRequests:0};
 }
 const candidates:Candidate[]=[];let cursor="",scanned=0,unparsed=0,unmatched=0;
 const cutoff=new Date().toISOString();
 while(true) {
  let query=client.from("gmail_archive_messages").select("id,account_id,gmail_message_id,gmail_thread_id,sent_at,encrypted_payload").eq("direction","inbound").in("nature",["permanent_bounce","temporary_bounce","delivery_report"]).lte("created_at",cutoff).order("id").limit(100);
  if(cursor)query=query.gt("id",cursor);
  const rows=checked(await query)||[];if(!rows.length)break;
  for(const row of rows) {
   scanned++;const s=JSON.parse(decrypt(row.encrypted_payload)) as MailSnapshot;
   const sender=s.participants.find(p=>p.role==="from")?.email||"";
   const reports=parseBounceReport({mimeType:"multipart/mixed",headers:[{name:"From",value:sender},{name:"References",value:s.references_header||""}],parts:[{mimeType:"text/plain",body:{data:Buffer.from(s.body||"").toString("base64url")}}]});
   if(!reports.length){unparsed++;continue;}
   for(const report of reports) {
    const c={account:row.account_id,notice:row.gmail_message_id,thread:row.gmail_thread_id,occurred:row.sent_at,report};
    const r=checked(await client.rpc("record_mail_bounce",{...c,dry_run:true})) as {matched:boolean};
    if(r.matched)candidates.push(c);else unmatched++;
   }
  }
  cursor=rows[rows.length-1].id;
 }
 await writeFile(planPath,JSON.stringify({createdAt:new Date().toISOString(),candidates}),{mode:0o600});
 return {phase:mode,scanned,candidates:candidates.length,uniqueRecipients:new Set(candidates.map(c=>c.report.recipient)).size,unparsed,unmatched,planSha256:createHash("sha256").update(JSON.stringify(candidates)).digest("hex"),providerRequests:0};
}
