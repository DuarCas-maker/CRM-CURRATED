import { db, checked } from "./db";
import { decrypt } from "../src/lib/server/crypto";
import type { MailSnapshot } from "../src/lib/gmail-history";
import { replyIntent } from "../src/lib/mail-interest";

export async function recordReplyIntent(
  archiveId: string,
  snapshot: MailSnapshot,
) {
  checked(
    await db().rpc("gmail_record_reply", {
      archive: archiveId,
      intent: replyIntent({
        ...snapshot,
        sender: snapshot.participants.find((p) => p.role === "from")?.email,
      }),
    }),
  );
}

// No Gmail listing and no external classifier: migrate the encrypted evidence
// already in the CRM in durable, bounded batches. Failed batches can be replayed.
export async function reconcileEngagement(payload: {
  phase?: string;
  after?: string;
}) {
  const client = db();
  const archived = payload.phase !== "messages";
  let query = client
    .from(archived ? "gmail_archive_messages" : "messages")
    .select("*")
    .order("id")
    .limit(25);
  if (payload.after) query = query.gt("id", payload.after);
  if (!archived) query = query.is("archive_message_id", null);
  const rows = checked(await query) || [];
  for (const row of rows) {
    if (archived) {
      const snapshot = JSON.parse(
        decrypt(row.encrypted_payload),
      ) as MailSnapshot;
      await recordReplyIntent(row.id, snapshot);
      checked(
        await client.rpc("gmail_associate_continuous", { archive: row.id }),
      );
      // Existing links are also processed: rejection/visibility must be reconciled.
      checked(
        await client.rpc("gmail_link_message", {
          archive_id: row.id,
          snapshot,
        }),
      );
    } else {
      checked(
        await client
          .from("messages")
          .update({ reply_intent: replyIntent(row) })
          .eq("id", row.id),
      );
    }
  }
  if (rows.length === 25 || archived) {
    const next =
      rows.length === 25
        ? { phase: archived ? "archive" : "messages", after: rows.at(-1)!.id }
        : { phase: "messages" };
    checked(
      await client.from("jobs").upsert(
        {
          kind: "gmail_engagement_reconcile",
          payload: next,
          dedupe_key: `engagement-reconcile:${next.phase}:${next.after || "start"}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
  }
}

export async function linkEngagementThread(payload: {
  account_id: string;
  thread_id: string;
  opportunity_id?: string;
  after?: string;
}) {
  const client = db();
  let query = client
    .from("gmail_archive_messages")
    .select("id,encrypted_payload")
    .eq("account_id", payload.account_id)
    .eq("gmail_thread_id", payload.thread_id)
    .order("id")
    .limit(25);
  if (payload.after) query = query.gt("id", payload.after);
  const rows = checked(await query) || [];
  for (const row of rows) {
    const snapshot = JSON.parse(decrypt(row.encrypted_payload)) as MailSnapshot;
    await recordReplyIntent(row.id, snapshot);
    checked(
      await client.rpc("gmail_link_message", { archive_id: row.id, snapshot }),
    );
    checked(await client.rpc("gmail_process_live_reply", { archive: row.id }));
  }
  if (rows.length === 25)
    checked(
      await client.from("jobs").upsert(
        {
          kind: "gmail_engagement_thread",
          payload: { ...payload, after: rows.at(-1)!.id },
          dedupe_key: `engagement-thread-page:${payload.account_id}:${payload.thread_id}:${payload.opportunity_id || "current"}:${rows.at(-1)!.id}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
}
