import { db, checked, alertAdmins } from "./db";
import { workerErrorCode } from "./errors";
import { parseImport } from "../src/lib/server/parse-import";
import { normalizeRow, type Mapping } from "../src/lib/imports";
import { startScrub, pollScrub } from "./bouncer";
import {
  syncMailbox,
  syncMessage,
  renewWatch,
  sendNext,
  reconcileUncertain,
  syncLiveThread,
} from "./gmail";
import { scheduleCampaigns } from "./campaigns";
import { generatePdf } from "./pdf";
import { processUnderwriting } from "./underwriting";
import { deliverNotification } from "./notifications";
import {
  archiveStep,
  scheduleArchive,
  copyGmailAttachment,
  linkTeamThread,
} from "./gmail-archive";
import { gmailHistoryEnabled } from "../src/lib/gmail-feature";
import { gmailSyncMode } from "../src/lib/gmail-sync";
import { scheduleMailboxJobs, simpleMailboxSchedule } from "./gmail-schedule";
import { simpleMailEnabled } from "../src/lib/mail-connections";
import { serviceMailRuntime } from "../src/lib/server/mail-transport/runtime-service";
import {
  mailRoutingActive,
  mailRuntimeDependencies,
} from "../src/lib/server/mail-transport/runtime-context";
import { selectedMailboxSchedule } from "../src/lib/server/mail-transport/mailbox-schedule";
import { reconcileEngagement, linkEngagementThread } from "./gmail-engagement";
import { reconcileImportAttachments } from "./gmail-import-scope";
import { scheduleSendingUsage, syncSendingUsage } from "./gmail-sending-usage";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { workerExecutionMode, startWorkerPilot } from "./pilot-runtime";
import { manualFastSendEnabled, startManualSender } from "./manual-sender";
const executionMode = workerExecutionMode(process.env.WORKER_EXECUTION_MODE);
const fastManualEnabled = manualFastSendEnabled(
  process.env.MANUAL_MAIL_FAST_SEND_ENABLED,
);
let manualSender: ReturnType<typeof startManualSender> | null = null;
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
  manualSender?.requestStop();
});
process.on("SIGINT", () => {
  stopping = true;
  manualSender?.requestStop();
});
async function importBatch(batchId: string) {
  const client = db();
  const batch = checked(
    await client.from("import_batches").select("*").eq("id", batchId).single(),
  )!;
  if (batch.status === "completed") return;
  const blob = checked(
    await client.storage.from("imports").download(batch.storage_path),
  )!;
  const parsed = await parseImport(new File([blob], batch.name), batch.sheet);
  for (let offset = 0; offset < parsed.rows.length; offset += 250) {
    const rows = parsed.rows.slice(offset, offset + 250).map((r, index) => ({
      ...normalizeRow(r, batch.mapping as Mapping),
      row_number: offset + index + 2,
    }));
    checked(
      await client.rpc("ingest_import_chunk", { batch_id: batchId, rows }),
    );
  }
  checked(
    await client
      .from("import_batches")
      .update({ status: "completed", total: parsed.total })
      .eq("id", batchId),
  );
}
async function schedule() {
  const client = db();
  const routed = mailRoutingActive()
    ? await selectedMailboxSchedule(await mailRuntimeDependencies())
    : null;
  const bucket = Math.floor(Date.now() / 300000);
  let connectedQuery = client
    .from("mail_accounts")
    .select("id")
    .eq("status", "connected");
  if (gmailHistoryEnabled())
    connectedQuery = connectedQuery.eq("live_enabled", true);
  const connected = checked(await connectedQuery) || [];
  await scheduleSendingUsage(
    routed
      ? routed.map((a) => ({ id: a.account_id }))
      : checked(
          await client
            .from("mail_accounts")
            .select("id")
            .eq("status", "connected"),
        ) || [],
  );
  const verifications =
    checked(
      await client
        .from("verifications")
        .select("provider_batch_id")
        .eq("state", "submitted")
        .limit(1000),
    ) || [];
  for (const batchId of new Set(
    verifications.map((v) => v.provider_batch_id).filter(Boolean),
  ))
    checked(
      await client.from("jobs").upsert(
        {
          kind: "scrub_poll",
          payload: { batch_id: batchId },
          dedupe_key: `scrub-recover:${batchId}:${bucket}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
  const queued =
    checked(
      await client
        .from("verifications")
        .select("id")
        .eq("state", "queued")
        .limit(1),
    ) || [];
  if (queued.length)
    checked(
      await client.from("jobs").upsert(
        {
          kind: "scrub",
          payload: {},
          dedupe_key: `scrub-recover-queued:${bucket}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
  let credentials =
    routed ??
    (checked(
      await client
        .from("mail_credentials")
        .select("account_id,watch_expires_at")
        .in(
          "account_id",
          connected.map((a) => a.id),
        ),
    ) ||
      []);
  if (!routed && simpleMailEnabled())
    credentials = await simpleMailboxSchedule(
      credentials,
      serviceMailRuntime(),
    );
  await scheduleMailboxJobs(credentials, async (job) => {
    if (job.kind === "gmail_sync") {
      const pending =
        checked(
          await client
            .from("jobs")
            .select("id")
            .eq("kind", "gmail_sync")
            .contains("payload", { account_id: job.payload.account_id })
            .in("status", ["queued", "running"])
            .limit(1),
        ) || [];
      if (pending.length) return;
    }
    checked(
      await client
        .from("jobs")
        .upsert(job, { onConflict: "dedupe_key", ignoreDuplicates: true }),
    );
  });
  checked(await client.rpc("enqueue_overdue"));
  if (gmailHistoryEnabled()) await scheduleArchive();
  await reconcileUncertain();
}
let lastSchedule = 0;
if (executionMode !== "paused") db(); // Paused must not touch DB or providers.
const syncMode = gmailSyncMode(); // Reject configuration errors before processing jobs.
const pilot =
  executionMode === "pilot"
    ? await startWorkerPilot(process.env.WORKER_PILOT_ID, {
        rpc: async (name, parameters) =>
          checked(await db().rpc(name, parameters)),
        send: sendNext,
        readThread: syncLiveThread,
        stopRequested: () => stopping,
      })
    : null;
console.log(
  `Curated CRM worker starting. Execution mode: ${executionMode}. Gmail sync mode: ${syncMode}. Logs exclude contact and application data.`,
);
let pilotClosedReported = false;
if (executionMode === "normal" && fastManualEnabled) {
  const manualClient = db();
  manualSender = startManualSender({
    readyAccounts: async () =>
      checked(
        await manualClient
          .rpc("manual_mail_ready_accounts")
          .abortSignal(AbortSignal.timeout(10000)),
      ),
    send: (account) => sendNext({ manualAccount: account }),
    onError: (stage) =>
      console.error(
        stage === "discover"
          ? "MANUAL_MAIL_DISCOVERY_FAILED"
          : "MANUAL_MAIL_SEND_FAILED",
      ),
  });
}
const processHeartbeat = setInterval(() => {
  writeFile(
    process.env.WORKER_HEARTBEAT_FILE || ".local-worker-heartbeat",
    new Date().toISOString(),
  ).catch(() => {});
}, 15000);
while (!stopping) {
  try {
    await writeFile(
      process.env.WORKER_HEARTBEAT_FILE || ".local-worker-heartbeat",
      new Date().toISOString(),
    );
    if (executionMode === "paused") {
      await delay(3000);
      continue;
    }
    if (pilot) {
      try {
        if ((await pilot.cycle()) === "closed" && !pilotClosedReported) {
          pilotClosedReported = true;
          console.log("WORKER_PILOT_CLOSED");
        }
      } catch {
        console.error("WORKER_PILOT_HELD");
      }
      await delay(3000);
      continue;
    }
    if (Date.now() - lastSchedule > 60000) {
      try {
        await schedule();
      } catch {
        console.error("SCHEDULER_FAILED");
      }
      lastSchedule = Date.now();
    }
    try {
      await scheduleCampaigns();
    } catch {
      console.error("CAMPAIGN_SCHEDULER_FAILED");
    }
    try {
      await sendNext();
    } catch {
      console.error("SENDER_FAILED");
    }
    const client = db();
    const job = checked(await client.rpc("claim_job"))?.[0];
    if (!job) {
      await delay(3000);
      continue;
    }
    const heartbeat = setInterval(() => {
      client
        .rpc("extend_job", { job_id: job.id, lease: job.lease_token })
        .then(() => {});
    }, 60000);
    try {
      switch (job.kind) {
        case "gmail_sending_usage":
          await syncSendingUsage(job.payload);
          break;
        case "underwriting":
          await processUnderwriting(job);
          break;
        case "gmail_attachment_reconcile":
          await reconcileImportAttachments(job.payload);
          break;
        case "gmail_engagement_reconcile":
          await reconcileEngagement(job.payload);
          break;
        case "gmail_engagement_thread":
          await linkEngagementThread(job.payload);
          break;
        case "import":
          await importBatch(job.payload.batch_id);
          break;
        case "scrub":
          await startScrub();
          break;
        case "scrub_poll":
          await pollScrub(job.payload.batch_id);
          break;
        case "gmail_sync":
          await syncMailbox(job.payload.account_id, job.payload.route_revision);
          break;
        case "gmail_live_thread":
          await syncLiveThread(job.payload.account_id, job.payload.thread_id);
          break;
        case "gmail_archive":
          if (!gmailHistoryEnabled()) throw new Error("GMAIL_HISTORY_DISABLED");
          await archiveStep(job.payload.run_id);
          break;
        case "gmail_team_thread":
          if (gmailHistoryEnabled())
            await linkTeamThread(
              job.payload.evidence_id,
              job.payload.offset,
              job.payload.copy_since,
            );
          break;
        case "gmail_copy_attachment":
          if (!gmailHistoryEnabled()) throw new Error("GMAIL_HISTORY_DISABLED");
          await copyGmailAttachment(job.payload.file_id);
          break;
        case "gmail_message":
          await syncMessage(job.payload.account_id, job.payload.message_id);
          break;
        case "gmail_watch":
          await renewWatch(job.payload.account_id, job.payload.route_revision);
          break;
        case "pdf":
          await generatePdf(job.payload.application_id);
          break;
        case "notify":
          await deliverNotification(job.payload.notification_id);
          break;
        default:
          throw new Error("UNKNOWN_JOB");
      }
      checked(
        await client.rpc("finish_job", {
          job_id: job.id,
          lease: job.lease_token,
          success: true,
        }),
      );
      console.log(
        JSON.stringify({ job: job.id, kind: job.kind, result: "completed" }),
      );
    } catch (error) {
      checked(
        await client.rpc("finish_job", {
          job_id: job.id,
          lease: job.lease_token,
          success: false,
          error_code: workerErrorCode(error),
        }),
      );
      if (job.attempts >= 5) {
        if (job.kind === "gmail_archive")
          checked(
            await client
              .from("gmail_runs")
              .update({
                status: "failed",
                last_error: "GMAIL_SCAN_RETRY_EXHAUSTED",
                lease_token: null,
                lease_until: null,
              })
              .eq("id", job.payload.run_id)
              .in("status", ["analyzing", "importing"]),
          );
        if (job.kind === "import")
          checked(
            await client
              .from("import_batches")
              .update({ status: "failed" })
              .eq("id", job.payload.batch_id)
              .neq("status", "completed"),
          );
        await alertAdmins(
          `job-failed:${job.id}`,
          "An integration job needs administrator attention",
        );
      }
      console.error(
        JSON.stringify({
          job: job.id,
          kind: job.kind,
          result: "retry_or_failed",
          error_code: workerErrorCode(error),
        }),
      );
    } finally {
      clearInterval(heartbeat);
    }
  } catch {
    console.error("WORKER_CYCLE_FAILED");
    await delay(5000);
  }
}
await manualSender?.stop();
clearInterval(processHeartbeat);
if (pilot) {
  try {
    await pilot.stop();
  } catch {
    console.error("WORKER_PILOT_CLOSE_REQUIRED");
  }
}
console.log("Curated CRM worker stopped.");
