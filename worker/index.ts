import { db, checked, alertAdmins } from "./db";
import { parseImport } from "../src/lib/server/parse-import";
import { normalizeRow, type Mapping } from "../src/lib/imports";
import { startScrub, pollScrub } from "./bouncer";
import {
  syncMailbox,
  syncMessage,
  renewWatch,
  sendNext,
  reconcileUncertain,
} from "./gmail";
import { scheduleCampaigns } from "./campaigns";
import { generatePdf } from "./pdf";
import { deliverNotification } from "./notifications";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
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
  const bucket = Math.floor(Date.now() / 300000);
  const connected =
    checked(
      await client.from("mail_accounts").select("id").eq("status", "connected"),
    ) || [];
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
  const credentials =
    checked(
      await client
        .from("mail_credentials")
        .select("account_id,watch_expires_at")
        .in(
          "account_id",
          connected.map((a) => a.id),
        ),
    ) || [];
  for (const account of credentials) {
    checked(
      await client.from("jobs").upsert(
        {
          kind: "gmail_sync",
          payload: { account_id: account.account_id },
          dedupe_key: `reconcile:${account.account_id}:${bucket}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
    if (
      !account.watch_expires_at ||
      new Date(account.watch_expires_at).getTime() < Date.now() + 86400000
    )
      checked(
        await client.from("jobs").upsert(
          {
            kind: "gmail_watch",
            payload: { account_id: account.account_id },
            dedupe_key: `watch:${account.account_id}:${Math.floor(Date.now() / 3600000)}`,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        ),
      );
  }
  checked(await client.rpc("enqueue_overdue"));
  await reconcileUncertain();
}
let lastSchedule = 0;
db(); // Fail fast on missing deployment configuration.
console.log(
  "Curated CRM worker starting. Logs exclude contact and application data.",
);
while (!stopping) {
  try {
    await writeFile(
      process.env.WORKER_HEARTBEAT_FILE || ".local-worker-heartbeat",
      new Date().toISOString(),
    );
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
          await syncMailbox(job.payload.account_id);
          break;
        case "gmail_message":
          await syncMessage(job.payload.account_id, job.payload.message_id);
          break;
        case "gmail_watch":
          await renewWatch(job.payload.account_id);
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
    } catch {
      checked(
        await client.rpc("finish_job", {
          job_id: job.id,
          lease: job.lease_token,
          success: false,
          error_code: "PROCESSING_FAILED",
        }),
      );
      if (job.attempts >= 5) {
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
console.log("Curated CRM worker stopped.");
