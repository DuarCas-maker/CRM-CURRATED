import { parseBounceReport, hydrateBounceParts } from "../src/lib/mail-bounce";
import type { GmailMessage } from "../src/lib/gmail-history";
import { snapshotMessage } from "../src/lib/gmail-history";
import { gmail } from "../src/lib/server/google";
import { db, checked } from "./db";

/** Shared by continuous reception and explicit historical reconciliation. Never sends. */
export async function ingestBounce(account: {id:string;email:string}, msg: GmailMessage) {
  const snapshot = snapshotMessage(msg, account.email);
  if (snapshot.direction !== "inbound" || !["permanent_bounce", "temporary_bounce", "delivery_report"].includes(snapshot.nature)) return {reports:0,matched:0,cancelled:0};
  await hydrateBounceParts(msg.payload, id => gmail<{data:string}>(account.id, `messages/${encodeURIComponent(msg.id)}/attachments/${encodeURIComponent(id)}`));
  const reports = parseBounceReport(msg.payload);
  let matched=0,cancelled=0;
  for (const report of reports) {
    const result = checked(await db().rpc("record_mail_bounce", {account:account.id,notice:msg.id,thread:msg.threadId,occurred:snapshot.sent_at,report})) as {matched:boolean;cancelled?:number};
    if (result.matched) {matched++;cancelled+=result.cancelled||0;}
    else checked(await db().from("mail_review").upsert({account_id:account.id,gmail_message_id:msg.id,reason:"BOUNCE_CORRELATION_REQUIRED"},{onConflict:"account_id,gmail_message_id",ignoreDuplicates:true}));
  }
  if (!reports.length) checked(await db().from("mail_review").upsert({account_id:account.id,gmail_message_id:msg.id,reason:"DELIVERY_REPORT_REVIEW"},{onConflict:"account_id,gmail_message_id",ignoreDuplicates:true}));
  return {reports:reports.length,matched,cancelled};
}
