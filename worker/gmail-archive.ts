import { randomUUID } from "node:crypto";
import { db, checked } from "./db";
import { gmail, GmailError } from "../src/lib/server/google";
import { isGmailQuotaError } from "../src/lib/gmail-errors";
import { encrypt, decrypt, hash } from "../src/lib/server/crypto";
import {
  snapshotMessage,
  excludedGmailMessage,
  historicalQuery,
  twoMonthsBefore,
  shouldCopyGmailFile,
  type GmailMessage,
  type MailSnapshot,
} from "../src/lib/gmail-history";

type Run = {
  id: string;
  account_id: string;
  purpose: string;
  status: string;
  phase: string;
  from_at: string;
  until_at: string;
  copy_since: string;
  baseline_history_id: string | null;
  start_history_id: string | null;
  page_token: string | null;
  pending_ids: string[];
  offset_index: number;
  skipped: number;
  errors: number;
  exhausted: boolean;
  lease_token: string;
};
type Archive = { id: string; encrypted_payload: string };

export async function scheduleArchive() {
  const client = db();
  const accounts =
    checked(
      await client
        .from("mail_accounts")
        .select("*")
        .eq("status", "connected")
        .eq("sync_enabled", true),
    ) || [];
  for (const account of accounts) {
    const running =
      checked(
        await client
          .from("gmail_runs")
          .select("id")
          .eq("account_id", account.id)
          .in("status", ["analyzing", "importing", "paused"])
          .limit(1),
      ) || [];
    if (running.length) continue;
    const sync = checked(
      await client
        .from("gmail_sync_state")
        .select("*")
        .eq("account_id", account.id)
        .maybeSingle(),
    );
    if (
      sync?.last_synced_at &&
      Date.now() - new Date(sync.last_synced_at).getTime() < 60000
    )
      continue;
    const now = new Date().toISOString();
    const run = await client
      .from("gmail_runs")
      .insert({
        account_id: account.id,
        purpose: "continuous",
        from_at:
          sync?.last_synced_at ||
          new Date(Date.now() - 365 * 86400000).toISOString(),
        until_at: now,
        copy_since: twoMonthsBefore(now),
        start_history_id: sync?.history_id,
        created_by: account.owner_id,
      })
      .select("id")
      .single();
    // A competing scheduler can create the single active account scan first.
    if (run.error) continue;
    checked(
      await client
        .from("gmail_sync_state")
        .upsert(
          { account_id: account.id, active_run_id: run.data.id },
          { onConflict: "account_id" },
        ),
    );
  }
  const active =
    checked(
      await client
        .from("gmail_runs")
        .select("id,lease_until,retry_at")
        .in("status", ["analyzing", "importing"])
        .limit(100),
    ) || [];
  for (const run of active) {
    if (run.lease_until && new Date(run.lease_until).getTime() > Date.now())
      continue;
    if (run.retry_at && new Date(run.retry_at).getTime() > Date.now()) continue;
    checked(
      await client.from("jobs").upsert(
        {
          kind: "gmail_archive",
          payload: { run_id: run.id },
          dedupe_key: `gmail-archive:${run.id}:${Math.floor(Date.now() / 60000)}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
  }
  checked(await client.rpc("gmail_followups"));
}

export async function archiveStep(runId: string) {
  const client = db();
  const run = checked(
    await client.rpc("gmail_claim_run", { run: runId }),
  )?.[0] as Run | undefined;
  if (!run) return;
  const runHeartbeat = setInterval(() => {
    void client
      .from("gmail_runs")
      .update({ lease_until: new Date(Date.now() + 120000).toISOString() })
      .eq("id", run.id)
      .eq("lease_token", run.lease_token)
      .in("status", ["analyzing", "importing"])
      .then(() => {});
  }, 30000);
  try {
    const account = checked(
      await client
        .from("mail_accounts")
        .select("email,status")
        .eq("id", run.account_id)
        .single(),
    )!;
    if (account.status !== "connected") throw new GmailError(401);
    const update = async (values: Record<string, unknown>) => {
      const changed = checked(
        await client
          .from("gmail_runs")
          .update({ last_error: null, retry_at: null, ...values })
          .eq("id", run.id)
          .eq("lease_token", run.lease_token)
          .select("id"),
      );
      if (!changed?.length) throw new Error("GMAIL_SCAN_PAUSED");
      Object.assign(run, values);
    };
    if (run.status === "importing") {
      await importStep(run);
      return;
    }
    if (!run.baseline_history_id) {
      const profile = await gmail<{ historyId: string }>(
        run.account_id,
        "profile",
      );
      // Freeze the listing window AFTER taking the history baseline. Otherwise mail
      // arriving between clicking Analyze and this API call would fall in neither scan.
      const cutoff = new Date().toISOString();
      await update({
        baseline_history_id: profile.historyId,
        until_at: cutoff,
        copy_since: twoMonthsBefore(cutoff),
      });
    }
    if (run.phase === "list") {
      let ids: string[],
        page: string | undefined,
        estimated: number | undefined;
      if (run.start_history_id) {
        const params = new URLSearchParams({
          startHistoryId: run.start_history_id,
          maxResults: "100",
          ...(run.page_token ? { pageToken: run.page_token } : {}),
        });
        params.append("historyTypes", "messageAdded");
        params.append("historyTypes", "labelAdded");
        try {
          const result = await gmail<{
            history?: {
              messagesAdded?: { message: { id: string } }[];
              labelsAdded?: { message: { id: string } }[];
            }[];
            nextPageToken?: string;
          }>(run.account_id, `history?${params}`);
          ids = [
            ...new Set(
              (result.history || []).flatMap((h) =>
                [...(h.messagesAdded || []), ...(h.labelsAdded || [])].map(
                  (e) => e.message.id,
                ),
              ),
            ),
          ];
          page = result.nextPageToken;
        } catch (e) {
          if (!(e instanceof GmailError) || e.status !== 404) throw e;
          // A stale history cursor requires a complete reconciliation of the supported year,
          // not just a scan starting at the last successful sync timestamp.
          await update({
            start_history_id: null,
            page_token: null,
            from_at: new Date(Date.now() - 365 * 86400000).toISOString(),
          });
          return;
        }
      } else {
        const query = historicalQuery(run.from_at, run.until_at);
        const params = new URLSearchParams({
          q: query,
          maxResults: "100",
          includeSpamTrash: "false",
          ...(run.page_token ? { pageToken: run.page_token } : {}),
        });
        const result = await gmail<{
          messages?: { id: string }[];
          nextPageToken?: string;
          resultSizeEstimate?: number;
        }>(run.account_id, `messages?${params}`);
        ids = (result.messages || []).map((m) => m.id);
        page = result.nextPageToken;
        estimated = result.resultSizeEstimate;
      }
      await update({
        pending_ids: ids,
        offset_index: 0,
        page_token: page || null,
        exhausted: !page,
        phase: "read",
        ...(estimated !== undefined ? { estimated_messages: estimated } : {}),
      });
    }
    if (run.phase === "read") {
      const end = Math.min(run.offset_index + 3, run.pending_ids.length);
      const responses = await Promise.allSettled(
        run.pending_ids
          .slice(run.offset_index, end)
          .map((id) =>
            gmail<GmailMessage>(
              run.account_id,
              `messages/${encodeURIComponent(id)}?format=full`,
            ),
          ),
      );
      const start = run.offset_index;
      for (let i = run.offset_index; i < end; i++) {
        let skipped = false;
        try {
          const result = responses[i - start];
          if (result.status === "rejected") throw result.reason;
          const msg = result.value;
          if (excludedGmailMessage(msg)) skipped = true;
          else {
            const snapshot = snapshotMessage(msg, account.email);
            if (
              run.purpose === "continuous" &&
              snapshot.direction === "outbound" &&
              snapshot.internet_message_id
            ) {
              const sent = checked(
                await client
                  .from("outbox")
                  .select("id,status")
                  .eq("account_id", run.account_id)
                  .eq("message_id_header", snapshot.internet_message_id)
                  .maybeSingle(),
              );
              if (sent && sent.status !== "sent")
                checked(
                  await client.rpc("mark_sent", {
                    outbox_id: sent.id,
                    gmail_id: msg.id,
                    thread_id: msg.threadId,
                  }),
                );
            }
            const archiveId = checked(
              await client.rpc("gmail_store_message", {
                run: run.id,
                lease: run.lease_token,
                entry: {
                  ...snapshot,
                  body: undefined,
                  attachments: undefined,
                  attachment_index: snapshot.attachments.map(
                    ({ data: _data, ...a }) => a,
                  ),
                  encrypted_payload: encrypt(JSON.stringify(snapshot)),
                },
              }),
            ) as string;
            if (run.purpose === "continuous") {
              checked(
                await client.rpc("gmail_associate_continuous", {
                  archive: archiveId,
                }),
              );
              await linkAndCopy(
                {
                  id: archiveId,
                  encrypted_payload: encrypt(JSON.stringify(snapshot)),
                },
                run.copy_since,
              );
              checked(
                await client.rpc("gmail_process_live_reply", {
                  archive: archiveId,
                }),
              );
            }
          }
        } catch (e) {
          if (e instanceof GmailError && e.status === 404) skipped = true;
          else throw e;
        }
        await update({
          offset_index: i + 1,
          ...(skipped ? { skipped: run.skipped + 1 } : {}),
          lease_until: new Date(Date.now() + 120000).toISOString(),
        });
      }
      if (end === run.pending_ids.length) {
        if (run.exhausted) {
          checked(
            await client.rpc("gmail_build_preview", {
              run: run.id,
              lease: run.lease_token,
            }),
          );
          if (run.purpose === "continuous") {
            const pending = checked(
              await client.rpc("gmail_unlinked_message_count", { run: run.id }),
            ) as number;
            if (!pending)
              checked(
                await client
                  .from("gmail_runs")
                  .update({ status: "completed" })
                  .eq("id", run.id)
                  .eq("status", "review"),
              );
          }
        } else
          await update({ phase: "list", pending_ids: [], offset_index: 0 });
      }
    }
  } catch (e) {
    const code = e instanceof GmailError ? e.code : "GMAIL_SCAN_RETRY";
    const quota = isGmailQuotaError(e);
    const authorization =
      e instanceof GmailError &&
      (e.status === 401 || (e.status === 403 && !quota));
    const seconds = Math.max(
      e instanceof GmailError ? e.retryAfter : 0,
      Math.min(3600, 30 * 2 ** Math.min(run.errors, 7)),
    );
    checked(
      await client
        .from("gmail_runs")
        .update({
          last_error: code,
          errors: run.errors + 1,
          retry_at: new Date(Date.now() + seconds * 1000).toISOString(),
          ...(authorization
            ? { status: "paused", resume_status: run.status }
            : !quota && run.errors >= 4
              ? { status: "failed", resume_status: run.status }
              : {}),
        })
        .eq("id", run.id)
        .eq("lease_token", run.lease_token),
    );
    if (authorization)
      checked(
        await client
          .from("mail_accounts")
          .update({ status: e.status === 401 ? "disconnected" : "restricted" })
          .eq("id", run.account_id),
      );
    if (e instanceof GmailError)
      console.warn(
        JSON.stringify({
          kind: "gmail_archive",
          run: run.id,
          error: code,
          retry_seconds: seconds,
        }),
      );
    // The persisted run schedules quota retries. Retire this job so job retries
    // cannot exhaust attempts and mark a recoverable quota wait as failed.
    if (!quota) throw e;
  } finally {
    clearInterval(runHeartbeat);
    checked(
      await client
        .from("gmail_runs")
        .update({ lease_token: null, lease_until: null })
        .eq("id", run.id)
        .eq("lease_token", run.lease_token),
    );
    const pending = checked(
      await client
        .from("gmail_runs")
        .select("status,retry_at")
        .eq("id", run.id)
        .single(),
    )!;
    if (
      ["analyzing", "importing"].includes(pending.status) &&
      (!pending.retry_at || new Date(pending.retry_at).getTime() <= Date.now())
    )
      checked(
        await client.from("jobs").insert({
          kind: "gmail_archive",
          payload: { run_id: run.id },
          dedupe_key: `gmail-archive:${run.id}:${randomUUID()}`,
        }),
      );
  }
}

async function importStep(run: Run) {
  const client = db();
  const candidates =
    checked(
      await client
        .from("gmail_candidates")
        .select("*")
        .eq("run_id", run.id)
        .eq("selected", true)
        .is("imported_at", null)
        .order("id")
        .limit(5),
    ) || [];
  for (const c of candidates) {
    try {
      checked(
        await client.rpc("gmail_apply_candidate", {
          candidate: c.id,
          lease: run.lease_token,
        }),
      );
    } catch {
      checked(
        await client
          .from("gmail_candidates")
          .update({
            last_error: "Review company, case, process and lender associations",
          })
          .eq("id", c.id),
      );
      checked(
        await client
          .from("gmail_runs")
          .update({
            status: "failed",
            resume_status: "importing",
            last_error: "GMAIL_ASSOCIATION_REVIEW",
          })
          .eq("id", run.id)
          .eq("lease_token", run.lease_token),
      );
      return;
    }
  }
  // Always revisit linked messages; a crash between association and copying must be recoverable.
  if (candidates.length) return;
  {
    // DB cursor avoids PostgREST's default 1,000-row response limit and bounds each job.
    const page =
      checked(
        await client.rpc("gmail_import_message_page", {
          run: run.id,
          cursor_offset: run.offset_index,
        }),
      ) || [];
    for (const archive of page) await linkAndCopy(archive, run.copy_since);
    checked(
      await client
        .from("gmail_runs")
        .update({ offset_index: run.offset_index + page.length })
        .eq("id", run.id)
        .eq("lease_token", run.lease_token),
    );
    if (page.length === 10) return;
  }
  checked(
    await client
      .from("gmail_runs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", run.id)
      .eq("lease_token", run.lease_token),
  );
  checked(
    await client.rpc("gmail_archive_checkpoint", {
      account: run.account_id,
      checkpoint: run.baseline_history_id,
    }),
  );
  checked(
    await client
      .from("mail_accounts")
      .update({ sync_enabled: true })
      .eq("id", run.account_id),
  );
  checked(await client.rpc("gmail_followups"));
}

export async function linkAndCopy(archive: Archive, copySince: string) {
  const client = db();
  const snapshot = JSON.parse(
    decrypt(archive.encrypted_payload),
  ) as MailSnapshot;
  const linked = checked(
    await client.rpc("gmail_link_message", {
      archive_id: archive.id,
      snapshot,
    }),
  );
  if (!linked) return;
  const files =
    checked(
      await client
        .from("gmail_saved_attachments")
        .select("*")
        .eq("archive_message_id", archive.id),
    ) || [];
  for (const file of files) {
    const o = checked(
      await client
        .from("opportunities")
        .select("stage,archived_at")
        .eq("id", file.opportunity_id)
        .single(),
    )!;
    const active =
      !o.archived_at && !["funded", "lost", "paused"].includes(o.stage);
    if (
      file.storage_path ||
      !shouldCopyGmailFile(snapshot.sent_at, copySince, active, file.name)
    )
      continue;
    await copyGmailAttachment(file.id);
  }
}
export async function copyGmailAttachment(fileId: string) {
  const client = db();
  const file = checked(
    await client
      .from("gmail_saved_attachments")
      .select("*")
      .eq("id", fileId)
      .single(),
  )!;
  if (file.storage_path) return;
  if (file.size > 20 * 1024 * 1024) {
    checked(
      await client
        .from("gmail_saved_attachments")
        .update({ last_error: "Attachment exceeds the 20 MB copy limit" })
        .eq("id", file.id),
    );
    return;
  }
  const archive = checked(
    await client
      .from("gmail_archive_messages")
      .select("*")
      .eq("id", file.archive_message_id)
      .single(),
  )!;
  const snapshot = JSON.parse(
    decrypt(archive.encrypted_payload),
  ) as MailSnapshot;
  const part = snapshot.attachments.find((a) => a.part_id === file.part_id);
  if (!part) throw new Error("ATTACHMENT_NOT_FOUND");
  let data = part.data;
  if (!data && part.attachment_id)
    data = (
      await gmail<{ data: string }>(
        archive.account_id,
        `messages/${archive.gmail_message_id}/attachments/${part.attachment_id}`,
      )
    ).data;
  const bytes = Buffer.from(data || "", "base64url");
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new Error("ATTACHMENT_SIZE_INVALID");
  const contentHash = hash(bytes),
    path = `${file.opportunity_id}/${file.process_id}/${contentHash}`;
  // Store encrypted file content in a private bucket. Filename never controls the storage path.
  const encrypted = Buffer.from(encrypt(bytes.toString("base64")));
  const upload = await client.storage
    .from("gmail-documents")
    .upload(path, encrypted, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (upload.error && String(upload.error.statusCode) !== "409")
    throw new Error("GMAIL_FILE_UPLOAD_FAILED");
  checked(
    await client
      .from("gmail_saved_attachments")
      .update({
        storage_path: path,
        content_hash: contentHash,
        status: "received",
        last_error: null,
      })
      .eq("id", file.id),
  );
}
