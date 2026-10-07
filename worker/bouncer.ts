import { db, checked, alertAdmins } from "./db";
import { mapVerification } from "../src/lib/domain";
const base = "https://api.usebouncer.com/v1.1/email/verify/batch";
function headers() {
  if (!process.env.BOUNCER_API_KEY) throw new Error("MISSING_BOUNCER");
  return {
    "x-api-key": process.env.BOUNCER_API_KEY,
    "Content-Type": "application/json",
  };
}
export async function startScrub() {
  headers();
  const client = db();
  const contacts = checked(await client.rpc("claim_verifications")) as {
    id: string;
    email: string;
  }[];
  if (!contacts.length) return;
  let batchId: string;
  try {
    // Rows are durably reserved as uncertain BEFORE the chargeable request.
    const res = await fetch(base, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(contacts.map((c) => ({ email: c.email }))),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      if ([400, 401, 402, 403, 429].includes(res.status))
        checked(
          await client
            .from("verifications")
            .update({
              state: "technical_error",
              reason: `provider_http_${res.status}`,
            })
            .in(
              "id",
              contacts.map((c) => c.id),
            ),
        );
      throw new Error("BOUNCER_REQUEST_FAILED");
    }
    const response = await res.json();
    if (typeof response.batchId !== "string")
      throw new Error("BOUNCER_MISSING_BATCH_ID");
    batchId = response.batchId;
  } catch {
    await alertAdmins(
      `scrub:${contacts[0].id}`,
      "Email verification requires review; no automatic resubmission",
    );
    return;
  }
  checked(
    await client
      .from("verifications")
      .update({ state: "submitted", provider_batch_id: batchId })
      .in(
        "id",
        contacts.map((c) => c.id),
      ),
  );
  checked(
    await client.from("jobs").upsert(
      {
        kind: "scrub_poll",
        payload: { batch_id: batchId },
        dedupe_key: `scrub-poll:${batchId}:${Math.floor(Date.now() / 60000)}`,
        run_at: new Date(Date.now() + 60000).toISOString(),
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    ),
  );
  // Drain additional queued contacts using a separate, nonchargeable scheduling decision.
  const remaining =
    checked(
      await client
        .from("verifications")
        .select("id")
        .eq("state", "queued")
        .limit(1),
    ) || [];
  if (remaining.length)
    checked(
      await client.from("jobs").upsert(
        {
          kind: "scrub",
          payload: {},
          dedupe_key: `scrub-next:${contacts[0].id}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
}
export async function pollScrub(batchId: string) {
  const client = db();
  const response = await fetch(`${base}/${encodeURIComponent(batchId)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("BOUNCER_STATUS_FAILED");
  const status = await response.json();
  if (!["completed", "done"].includes(status.status)) {
    checked(
      await client.from("jobs").upsert(
        {
          kind: "scrub_poll",
          payload: { batch_id: batchId },
          dedupe_key: `scrub-poll:${batchId}:${Math.floor(Date.now() / 60000) + 1}`,
          run_at: new Date(Date.now() + 60000).toISOString(),
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
    return;
  }
  const results = await fetch(
    `${base}/${encodeURIComponent(batchId)}/download`,
    { headers: headers(), signal: AbortSignal.timeout(30000) },
  );
  if (!results.ok) throw new Error("BOUNCER_RESULTS_FAILED");
  const rows = (await results.json()) as {
    email: string;
    status: string;
    reason: string;
  }[];
  if (!Array.isArray(rows)) throw new Error("BOUNCER_INVALID_RESULTS");
  for (let i = 0; i < rows.length; i += 500)
    checked(
      await client.rpc("apply_verification_results", {
        batch: batchId,
        results: rows.slice(i, i + 500).map((r) => ({
          email: r.email.toLowerCase().trim(),
          result: mapVerification(r.status),
          reason: r.reason,
        })),
      }),
    );
}
