import test from "node:test";
import assert from "node:assert/strict";
import { parseBounceReport, hydrateBounceParts, bounceReason } from "../src/lib/mail-bounce";
import type { GmailPart } from "../worker/mime";
const data = (s:string) => Buffer.from(s).toString("base64url");
const report = (body:string):GmailPart => ({mimeType:"multipart/report",headers:[{name:"From",value:"Mail Delivery Subsystem <mailer-daemon@googlemail.com>"},{name:"References",value:"<original@crm.curated.local>"}],parts:[{mimeType:"message/delivery-status",body:{data:data(body)}}]});
test("DSN isolates recipients, preserves mailbox-full reason even for 552 5.2.2, ignores successes",()=>{
 const rows=parseBounceReport(report("Reporting-MTA: dns; google.com\r\n\r\nFinal-Recipient: rfc822; FULL@EXAMPLE.TEST\r\nAction: failed\r\nStatus: 5.2.2\r\nDiagnostic-Code: smtp; 552 5.2.2 inbox full\r\n\r\nFinal-Recipient: rfc822; missing@example.test\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\nFinal-Recipient: rfc822; delivered@example.test\r\nAction: delivered\r\nStatus: 2.0.0"));
 assert.deepEqual(rows.map(r=>[r.recipient,r.reason]),[["full@example.test","mailbox_full"],["missing@example.test","address_not_found"]]);
 assert.deepEqual(rows[0].references,["<original@crm.curated.local>"]);
});
test("persistent delays stop too; policy failures are not nonexistent addresses",()=>{
 assert.equal(bounceReason("4.2.2"),"mailbox_full");assert.equal(bounceReason("5.7.1"),"policy_rejected");assert.equal(bounceReason("5.0.0"),"delivery_failed");
 assert.equal(parseBounceReport(report("Final-Recipient: rfc822; full@example.test\nAction: delayed\nStatus: 4.2.2"))[0].action,"delayed");
});
test("human quoted report, auto reply, subject-only and positive delivery cannot block",()=>{
 const p=report("Final-Recipient: rfc822; x@example.test\nAction: failed\nStatus: 5.1.1");p.mimeType="multipart/mixed";p.headers=[{name:"From",value:"human@example.test"}];assert.deepEqual(parseBounceReport(p),[]);
 assert.deepEqual(parseBounceReport(report("Final-Recipient: rfc822; x@example.test\nAction: delivered\nStatus: 2.0.0")),[]);
 assert.deepEqual(parseBounceReport({mimeType:"text/plain",headers:[{name:"From",value:"mailer-daemon@googlemail.com"}],body:{data:data("Address not found x@example.test")}}),[]);
});
test("Google standard fallback extracts exactly failed recipient and original header, never quoted errors",()=>{
 const p:GmailPart={mimeType:"multipart/mixed",headers:[{name:"From",value:"Mail Delivery Subsystem <mailer-daemon@googlemail.com>"}],parts:[{mimeType:"text/plain",body:{data:data("Recipient inbox full\nYour message couldn't be delivered to full@example.test. Their inbox is full.\n552 5.2.2 mailbox full")}},{mimeType:"text/rfc822-headers",body:{data:data("Message-ID: <original@crm.curated.local>\r\nTo: full@example.test")}}]};
 assert.equal(parseBounceReport(p)[0].recipient,"full@example.test");assert.equal(parseBounceReport(p)[0].references[0],"<original@crm.curated.local>");
 p.parts![0].body!.data=data("Address not found\nYour message wasn't delivered to missing@example.test because the address couldn't be found.\n550 5.1.1");assert.equal(parseBounceReport(p)[0].reason,"address_not_found");
 p.parts![0].body!.data=data("On Tuesday someone wrote:\n> Your message couldn't be delivered to full@example.test.\n552 5.2.2");assert.deepEqual(parseBounceReport(p),[]);
});
test("bounded report hydration fetches only relevant parts and fails closed",async()=>{
 const p=report("");p.parts![0].body={attachmentId:"dsn",size:100};p.parts!.push({mimeType:"application/pdf",body:{attachmentId:"private",size:10}});
 const calls:string[]=[];await hydrateBounceParts(p,async id=>{calls.push(id);return {data:data("Final-Recipient: rfc822; full@example.test\nAction: failed\nStatus: 5.2.2")};});
 assert.deepEqual(calls,["dsn"]);assert.equal(parseBounceReport(p).length,1);
 p.parts![0].body={attachmentId:"too-big",size:300000};await assert.rejects(hydrateBounceParts(p,async()=>({data:"bad"})),/TOO_LARGE/);
});
