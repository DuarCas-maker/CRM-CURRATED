import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { serviceClient } from "../supabase";
import { MailQuotaError } from "../mail-quota";
import { withMailboxScope } from "./mailbox-context";

type Job = { id: string; lease_token: string; kind: string; payload: { account_id?: unknown } };
type Proof = { account: string; job_id: string | null; lease: string | null; outbox_id: string | null; claim: string | null; kind: string; sent: boolean };
const contexts = new AsyncLocalStorage<Proof>();
export function withLegacyWorkerJob<T>(job: Job, action: () => Promise<T>) {
  const account = z.uuid().safeParse(job.payload.account_id);
  if (!account.success) return action();
  return contexts.run({ account: account.data, job_id: job.id, lease: job.lease_token, outbox_id: null, claim: null, kind: job.kind, sent: false }, action);
}
export function withLegacyWorkerDispatch<T>(account: string, outbox: string, claim: string, action: () => Promise<T>) {
  return contexts.run({ account, job_id: null, lease: null, outbox_id: outbox, claim, kind: "dispatch", sent: false }, action);
}
export function withLegacyWorkerReconciliation<T>(account: string, outbox: string, action: () => Promise<T>) {
  return contexts.run({ account, job_id: null, lease: null, outbox_id: outbox, claim: null, kind: "reconcile", sent: false }, action);
}
export async function withLegacyWorkerRequest<T>(
  account: string, path: string, method: string, stillLegacy: () => boolean, action: () => Promise<T>,
) {
  const proof = contexts.getStore();
  if (!proof || proof.account !== account || !z.uuid().safeParse(account).success) throw new MailQuotaError("QGR_DENIED");
  const part = path.split("?")[0];
  const read = method === "GET" && /^(?:profile|history|messages|messages\/[A-Za-z0-9_-]+(?:\/attachments\/[A-Za-z0-9_-]+)?|threads\/[A-Za-z0-9_-]+)$/.test(part);
  const dispatch = proof.kind === "dispatch";
  const reconcile = proof.kind === "reconcile";
  if (dispatch && ![proof.outbox_id, proof.claim].every(value => z.uuid().safeParse(value).success)) throw new MailQuotaError("QGR_DENIED");
  const send = method === "POST" && path === "messages/send";
  const signature = method === "GET" && /^settings\/sendAs\/[^?/#]+$/.test(path);
  const watch = proof.kind === "gmail_watch" && ((method === "POST" && path === "watch") || (method === "POST" && path === "stop"));
  const jobKind = ["gmail_sending_usage", "gmail_sync", "gmail_message", "gmail_live_thread", "gmail_engagement_thread", "gmail_watch"].includes(proof.kind);
  if (dispatch ? (!send && !signature) || (send && proof.sent) : reconcile ? !(method === "GET" && part === "messages") : !jobKind || (!read && !watch)) throw new MailQuotaError("QGR_DENIED");
  const args = { account, job_id: proof.job_id, lease: proof.lease, outbox_id: proof.outbox_id, claim: proof.claim };
  const context = async () => {
    if (!stillLegacy()) return null;
    const result = await serviceClient().rpc("legacy_worker_mail_context", args);
    if (result.error) throw new MailQuotaError("QGR_UNAVAILABLE");
    return typeof result.data === "string" && /^[a-f0-9]{64}$/.test(result.data) ? result.data : null;
  };
  const captured = await context();
  if (!captured) throw new MailQuotaError("QGR_DENIED");
  if (send) proof.sent = true;
  return withMailboxScope({ account, revision: 0, directOnly: true, validate: async () => await context() === captured }, action);
}
