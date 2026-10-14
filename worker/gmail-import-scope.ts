import { db, checked } from "./db";

// Reconcile existing participant counters without fetching or copying files.
// Durable, deterministic page identities allow a failed batch to be replayed.
export async function reconcileImportAttachments(payload: { after?: string }) {
  const client = db();
  let query = client
    .from("gmail_candidates")
    .select("id")
    .order("id")
    .limit(50);
  if (payload.after) query = query.gt("id", payload.after);
  const candidates = checked(await query) || [];
  for (const candidate of candidates)
    checked(
      await client.rpc("gmail_refresh_candidate_thread_stats", {
        candidate: candidate.id,
      }),
    );
  if (candidates.length === 50) {
    const after = candidates.at(-1)!.id;
    checked(
      await client
        .from("jobs")
        .upsert(
          {
            kind: "gmail_attachment_reconcile",
            payload: { after },
            dedupe_key: `gmail-attachment-reconcile:026:${after}`,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        ),
    );
  }
}
