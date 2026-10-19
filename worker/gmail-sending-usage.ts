import { db, checked } from "./db";
import { gmail } from "../src/lib/server/google";
import { hash } from "../src/lib/server/crypto";

export async function scheduleSendingUsage(accounts: { id: string }[]) {
  const client = db();
  for (const account of accounts) {
    const pending = checked(
      await client
        .from("jobs")
        .select("id")
        .eq("kind", "gmail_sending_usage")
        .contains("payload", { account_id: account.id })
        .in("status", ["queued", "running"])
        .limit(1),
    );
    if (pending?.length) continue;
    const cycle = Math.floor(Date.now() / 300000);
    checked(
      await client
        .from("jobs")
        .upsert(
          {
            kind: "gmail_sending_usage",
            payload: {
              account_id: account.id,
              since: Math.floor((Date.now() - 86400000) / 1000),
              cycle,
            },
            dedupe_key: `sending-usage:${account.id}:${cycle}`,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        ),
    );
  }
}

// Small resumable pages keep mailbox accounting from monopolizing the worker.
export async function syncSendingUsage(payload: {
  account_id: string;
  since: number;
  cycle: number;
  page_token?: string;
}) {
  const client = db();
  const query = new URLSearchParams({
    q: `in:sent after:${payload.since}`,
    maxResults: "50",
  });
  if (payload.page_token) query.set("pageToken", payload.page_token);
  const result = await gmail<{
    messages?: { id: string }[];
    nextPageToken?: string;
  }>(payload.account_id, `messages?${query}`);
  const ids = (result.messages || []).map((m) => m.id);
  const known = ids.length
    ? checked(
        await client
          .from("gmail_sent_usage")
          .select("gmail_message_id")
          .eq("account_id", payload.account_id)
          .in("gmail_message_id", ids),
      ) || []
    : [];
  for (const id of ids.filter(
    (id) => !known.some((row) => row.gmail_message_id === id),
  )) {
    const params = new URLSearchParams({ format: "metadata" });
    for (const header of ["Message-ID", "To", "Cc", "Bcc"])
      params.append("metadataHeaders", header);
    const message = await gmail<{
      internalDate: string;
      payload?: { headers?: { name: string; value: string }[] };
    }>(payload.account_id, `messages/${encodeURIComponent(id)}?${params}`);
    const headers = message.payload?.headers || [];
    const addresses = headers
      .filter((h) => ["to", "cc", "bcc"].includes(h.name.toLowerCase()))
      .flatMap(
        (h) =>
          h.value.match(
            /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
          ) || [],
      );
    checked(
      await client
        .from("gmail_sent_usage")
        .upsert(
          {
            account_id: payload.account_id,
            gmail_message_id: id,
            internet_message_id:
              headers.find((h) => h.name.toLowerCase() === "message-id")
                ?.value || null,
            sent_at: new Date(Number(message.internalDate)).toISOString(),
            recipients: Math.max(1, addresses.length),
          },
          { onConflict: "account_id,gmail_message_id" },
        ),
    );
  }
  if (result.nextPageToken) {
    checked(
      await client
        .from("jobs")
        .upsert(
          {
            kind: "gmail_sending_usage",
            payload: { ...payload, page_token: result.nextPageToken },
            dedupe_key: `sending-usage:${payload.account_id}:${payload.cycle}:${hash(result.nextPageToken)}`,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        ),
    );
  } else {
    checked(
      await client
        .from("mail_accounts")
        .update({ external_usage_synced_at: new Date().toISOString() })
        .eq("id", payload.account_id),
    );
    checked(
      await client
        .from("gmail_sent_usage")
        .delete()
        .eq("account_id", payload.account_id)
        .lt("sent_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    );
  }
}
