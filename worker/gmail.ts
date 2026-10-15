import { db, checked, alertAdmins } from "./db";
import { gmail, GmailError, organization } from "../src/lib/server/google";
import { hash, encrypt } from "../src/lib/server/crypto";
import { gmailHistoryEnabled } from "../src/lib/gmail-feature";
import { gmailPushEnabled } from "../src/lib/gmail-sync";
import { recordReplyIntent } from "./gmail-engagement";
import { isGmailQuotaError } from "../src/lib/gmail-errors";
import { decrypt } from "../src/lib/server/crypto";
import {
  excludedGmailMessage,
  snapshotMessage,
} from "../src/lib/gmail-history";
import {
  buildMime,
  messageText,
  attachments,
  emailAddress,
  type GmailPart,
  type Attachment,
} from "./mime";
type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds: string[];
  payload: GmailPart;
};
export async function syncMessage(accountId: string, messageId: string) {
  const account = checked(
    await db()
      .from("mail_accounts")
      .select("id,email")
      .eq("id", accountId)
      .single(),
  )!;
  const msg = await gmail<GmailMessage>(
    accountId,
    `messages/${messageId}?format=full`,
  );
  await ingestMessage(account, msg);
}
export async function renewWatch(accountId: string) {
  // Old queued watch jobs are completed without calling Gmail after switching modes.
  if (!gmailPushEnabled()) return;
  const account = checked(
    await db()
      .from("mail_accounts")
      .select("organization")
      .eq("id", accountId)
      .single(),
  )!;
  const topic =
    organization(account.organization).pubsubTopic ||
    process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topic) throw new Error("MISSING_PUBSUB_TOPIC");
  const result = await gmail<{ historyId: string; expiration: string }>(
    accountId,
    "watch",
    {
      method: "POST",
      body: JSON.stringify({ topicName: topic }),
    },
  );
  checked(
    await db()
      .from("mail_credentials")
      .update({
        watch_expires_at: new Date(Number(result.expiration)).toISOString(),
      })
      .eq("account_id", accountId),
  );
}
export async function syncMailbox(accountId: string) {
  const client = db();
  const account = checked(
    await client.from("mail_accounts").select("*").eq("id", accountId).single(),
  )!;
  const credentials = checked(
    await client
      .from("mail_credentials")
      .select("*")
      .eq("account_id", accountId)
      .single(),
  )!;
  const baseline = await gmail<{ historyId: string }>(accountId, "profile");
  const ids = new Set<string>();
  let page: string | undefined;
  let full = !credentials.history_id;
  if (!full) {
    try {
      do {
        const params = new URLSearchParams({
          startHistoryId: credentials.history_id,
          historyTypes: "messageAdded",
          maxResults: "500",
          ...(page ? { pageToken: page } : {}),
        });
        const response = await gmail<{
          history?: { messagesAdded?: { message: { id: string } }[] }[];
          nextPageToken?: string;
        }>(accountId, `history?${params}`);
        for (const event of response.history || [])
          for (const m of event.messagesAdded || []) ids.add(m.message.id);
        page = response.nextPageToken;
      } while (page);
    } catch (e) {
      if (e instanceof GmailError && e.status === 404) full = true;
      else throw e;
    }
  }
  if (full) {
    page = undefined;
    const since =
      Math.floor(
        new Date(
          credentials.last_reconciled_at ||
            account.live_started_at ||
            account.created_at,
        ).getTime() / 1000,
      ) - 86400;
    do {
      const response: { messages?: { id: string }[]; nextPageToken?: string } =
        await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(
          accountId,
          `messages?${new URLSearchParams({ q: `after:${since} -in:spam -in:trash -in:drafts`, maxResults: "500", includeSpamTrash: "false", ...(page ? { pageToken: page } : {}) })}`,
        );
      for (const m of response.messages || []) ids.add(m.id);
      page = response.nextPageToken;
    } while (page);
  }
  for (const id of ids) {
    let msg: GmailMessage;
    try {
      msg = await gmail<GmailMessage>(accountId, `messages/${id}?format=full`);
    } catch (e) {
      if (e instanceof GmailError && e.status === 404) continue;
      throw e;
    }
    await ingestMessage(account, msg);
  }
  checked(
    await client.rpc("advance_gmail_history", {
      account: accountId,
      checkpoint: baseline.historyId,
    }),
  );
}
async function ingestMessage(
  account: { id: string; email: string },
  msg: GmailMessage,
) {
  if (excludedGmailMessage(msg)) return;
  if (gmailHistoryEnabled()) {
    await ingestLiveMessage(account, msg);
    return;
  }
  const client = db();
  const nature = snapshotMessage(msg, account.email).nature;
  const h = (name: string) =>
    msg.payload.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value || "";
  const from = emailAddress(h("From"));
  const outbound = msg.labelIds?.includes("SENT") || from === account.email;
  const peer = outbound ? emailAddress(h("To")) : from;
  const team = gmailHistoryEnabled()
    ? checked(
        await client
          .from("gmail_team_members")
          .select("email")
          .in("email", [...new Set([from, peer])]),
      ) || []
    : [];
  const teamSender = team.some((t) => t.email === from);
  const teamPeer = team.some((t) => t.email === peer);
  const body = messageText(msg.payload).slice(0, 100000);
  let conversation = checked(
    await client
      .from("conversations")
      .select("*")
      .eq("account_id", account.id)
      .eq("gmail_thread_id", msg.threadId)
      .maybeSingle(),
  );
  const bounce =
    !outbound &&
    (msg.payload.mimeType === "multipart/report" ||
      /^(mailer-daemon|postmaster)@/i.test(from));
  if (!conversation && bounce) {
    const refs = [
      ...new Set(
        `${h("In-Reply-To")} ${h("References")} ${body}`.match(
          /<[A-Za-z0-9_.:-]+@crm\.curated\.local>/g,
        ) || [],
      ),
    ].slice(0, 50);
    if (refs.length) {
      const matches =
        checked(
          await client
            .from("outbox")
            .select("opportunity_id,submission_id,area")
            .eq("account_id", account.id)
            .in("message_id_header", refs)
            .not("opportunity_id", "is", null)
            .limit(2),
        ) || [];
      if (matches.length === 1)
        conversation = checked(
          await client
            .from("conversations")
            .upsert(
              {
                opportunity_id: matches[0].opportunity_id,
                submission_id: matches[0].submission_id,
                area: matches[0].area,
                account_id: account.id,
                gmail_thread_id: msg.threadId,
                subject: h("Subject") || "Delivery status",
              },
              {
                onConflict: "account_id,gmail_thread_id",
                ignoreDuplicates: true,
              },
            )
            .select("*")
            .single(),
        )!;
      else if (matches.length > 1) {
        checked(
          await client.from("mail_review").upsert(
            {
              account_id: account.id,
              gmail_message_id: msg.id,
              reason: "Ambiguous delivery report",
              candidate_ids: matches.map((m) => m.opportunity_id),
            },
            {
              onConflict: "account_id,gmail_message_id",
              ignoreDuplicates: true,
            },
          ),
        );
        return;
      }
    }
  }
  if (!conversation) {
    // Team addresses are never customer matching keys. The historical/continuous
    // archive retains their mail for individual thread association.
    if (teamPeer) return;
    // Exact outgoing Message-ID can recover a send that completed before acknowledgement.
    const pending = checked(
      await client
        .from("outbox")
        .select("id")
        .eq("account_id", account.id)
        .eq("message_id_header", h("Message-ID"))
        .maybeSingle(),
    );
    if (outbound && pending) {
      checked(
        await client.rpc("mark_sent", {
          outbox_id: pending.id,
          gmail_id: msg.id,
          thread_id: msg.threadId,
        }),
      );
      return;
    }
    const knownLender =
      checked(
        await client.from("lenders").select("id").eq("email", peer).limit(1),
      ) || [];
    if (knownLender.length) {
      checked(
        await client.from("mail_review").upsert(
          {
            account_id: account.id,
            gmail_message_id: msg.id,
            reason: "Lender thread requires an explicit submission association",
          },
          {
            onConflict: "account_id,gmail_message_id",
            ignoreDuplicates: true,
          },
        ),
      );
      return;
    }
    const contact = checked(
      await client
        .from("contacts")
        .select("id")
        .eq("email", peer)
        .maybeSingle(),
    );
    if (!contact) return;
    const opportunities =
      checked(
        await client
          .from("opportunities")
          .select("id,handed_off_at")
          .eq("contact_id", contact.id)
          .is("archived_at", null)
          .not("stage", "in", "(funded,lost)")
          .limit(2),
      ) || [];
    if (opportunities.length !== 1 || opportunities[0].handed_off_at) {
      checked(
        await client.from("mail_review").upsert(
          {
            account_id: account.id,
            gmail_message_id: msg.id,
            reason: "Ambiguous opportunity or negotiation phase",
            candidate_ids: opportunities.map((o) => o.id),
          },
          {
            onConflict: "account_id,gmail_message_id",
            ignoreDuplicates: true,
          },
        ),
      );
      if (!outbound && nature === "personal")
        checked(
          await client.rpc("stop_contact_sequence", {
            contact: contact.id,
            why: "replied",
          }),
        );
      return;
    }
    conversation = checked(
      await client
        .from("conversations")
        .upsert(
          {
            opportunity_id: opportunities[0].id,
            account_id: account.id,
            gmail_thread_id: msg.threadId,
            subject: h("Subject") || "(No subject)",
            area: "seller",
          },
          { onConflict: "account_id,gmail_thread_id" },
        )
        .select("*")
        .single(),
    )!;
  }
  // Idempotent message insert, but repeated sync still re-applies sequence stopping safely.
  const stored = checked(
    await client
      .from("messages")
      .upsert(
        {
          conversation_id: conversation.id,
          gmail_message_id: msg.id,
          direction: outbound ? "outbound" : "inbound",
          sender: from,
          body,
          sent_at: new Date(Number(msg.internalDate)).toISOString(),
          status: outbound ? "sent" : "received",
          internet_message_id: h("Message-ID"),
          ...(gmailHistoryEnabled() ? { nature } : {}),
          references_header: h("References"),
        },
        {
          onConflict: "conversation_id,gmail_message_id",
          ignoreDuplicates: true,
        },
      )
      .select("id")
      .maybeSingle(),
  );
  if (stored) {
    for (const a of attachments(msg.payload))
      checked(
        await client.from("message_attachments").upsert(
          {
            message_id: stored.id,
            gmail_attachment_id: a.body!.attachmentId!,
            name: a.filename!,
            mime_type: a.mimeType || "application/octet-stream",
            size: a.body!.size || 0,
          },
          {
            onConflict: "message_id,gmail_attachment_id",
            ignoreDuplicates: true,
          },
        ),
      );
  }
  const opportunity = checked(
    await client
      .from("opportunities")
      .select("contact_id,seller_id,closer_id,handed_off_at")
      .eq("id", conversation.opportunity_id)
      .single(),
  )!;
  if (!outbound) {
    if (
      conversation.area === "seller" &&
      !teamSender &&
      (nature === "personal" || nature === "permanent_bounce")
    ) {
      checked(
        await client.rpc("stop_contact_sequence", {
          contact: opportunity.contact_id,
          why: bounce ? "bounced" : "replied",
        }),
      );
      if (nature === "permanent_bounce")
        checked(
          await client.rpc("suppress_contact", {
            contact: opportunity.contact_id,
            reason: "bounce",
          }),
        );
      else if (
        /^\s*(unsubscribe|remove me|stop emailing|stop sending|please remove|please unsubscribe)\b/i.test(
          body,
        )
      )
        checked(
          await client.rpc("suppress_contact", {
            contact: opportunity.contact_id,
            reason: "email_unsubscribe",
          }),
        );
    }
    if (stored) {
      checked(
        await client
          .from("conversations")
          .update({
            ...(teamSender ? {} : { needs_attention: true }),
            updated_at: new Date(Number(msg.internalDate)).toISOString(),
          })
          .eq("id", conversation.id),
      );
      checked(
        await client.rpc("notify_user", {
          recipient:
            conversation.area === "closer" ||
            (opportunity.handed_off_at &&
              Number(msg.internalDate) >=
                new Date(opportunity.handed_off_at).getTime())
              ? opportunity.closer_id
              : opportunity.seller_id,
          event: `reply:${account.id}:${msg.id}`,
          title_text: teamSender
            ? "New team message received"
            : "New reply received",
        }),
      );
    }
  }
}
export async function ingestLiveMessage(
  account: { id: string; email: string },
  msg: GmailMessage,
) {
  if (excludedGmailMessage(msg)) return;
  const client = db();
  const snapshot = snapshotMessage(msg, account.email);
  if (snapshot.direction === "outbound" && snapshot.internet_message_id) {
    const pending = checked(
      await client
        .from("outbox")
        .select("id,status")
        .eq("account_id", account.id)
        .eq("message_id_header", snapshot.internet_message_id)
        .maybeSingle(),
    );
    if (pending && pending.status !== "sent")
      checked(
        await client.rpc("mark_sent", {
          outbox_id: pending.id,
          gmail_id: msg.id,
          thread_id: msg.threadId,
        }),
      );
  }
  const archive = checked(
    await client
      .from("gmail_archive_messages")
      .upsert(
        {
          account_id: account.id,
          ...snapshot,
          body: undefined,
          attachments: undefined,
          attachment_index: snapshot.attachments.map(
            ({ data: _data, ...file }) => file,
          ),
          encrypted_payload: encrypt(JSON.stringify(snapshot)),
          is_live: true,
        },
        { onConflict: "account_id,gmail_message_id" },
      )
      .select("id")
      .single(),
  )!;
  await recordReplyIntent(archive.id, snapshot);
  checked(
    await client.rpc("gmail_associate_continuous", { archive: archive.id }),
  );
  const linked = checked(
    await client.rpc("gmail_link_message", {
      archive_id: archive.id,
      snapshot,
    }),
  );
  if (!linked) return;
  checked(
    await client
      .from("messages")
      .update({
        references_header: snapshot.references_header,
        ...(snapshot.internet_message_id
          ? { internet_message_id: snapshot.internet_message_id }
          : {}),
      })
      .eq("id", linked),
  );
  if (snapshot.direction === "inbound") {
    const files =
      checked(
        await client
          .from("gmail_saved_attachments")
          .update({ auto_saved: true })
          .eq("archive_message_id", archive.id)
          .select("id,storage_path"),
      ) || [];
    // A failed attachment does not block reception. A durable job retries each copy.
    for (const file of files)
      if (!file.storage_path)
        checked(
          await client.from("jobs").upsert(
            {
              kind: "gmail_copy_attachment",
              payload: { file_id: file.id },
              dedupe_key: `live-file:${file.id}`,
            },
            { onConflict: "dedupe_key", ignoreDuplicates: true },
          ),
        );
  }
  checked(
    await client.rpc("gmail_process_live_reply", { archive: archive.id }),
  );
  checked(await client.rpc("gmail_track_live_wait", { archive: archive.id }));
  if (snapshot.direction === "inbound" && snapshot.nature === "personal") {
    const senderTeam =
      checked(
        await client
          .from("gmail_team_members")
          .select("email")
          .in(
            "email",
            snapshot.participants
              .filter((p) => p.role === "from")
              .map((p) => p.email),
          )
          .limit(1),
      ) || [];
    const link = checked(
      await client
        .from("gmail_thread_links")
        .select("opportunity_id")
        .eq("account_id", account.id)
        .eq("gmail_thread_id", msg.threadId)
        .single(),
    )!;
    const opportunity = checked(
      await client
        .from("opportunities")
        .select("seller_id,closer_id")
        .eq("id", link.opportunity_id)
        .single(),
    )!;
    for (const recipient of new Set(
      [opportunity.seller_id, opportunity.closer_id].filter(Boolean),
    ))
      checked(
        await client.rpc("notify_user", {
          recipient,
          event: `live-reply:${link.opportunity_id}:${snapshot.internet_message_id ? hash(snapshot.internet_message_id) : `${account.id}:${msg.id}`}`,
          title_text: senderTeam.length
            ? "New team message received"
            : "New email received in your case",
        }),
      );
  }
}
export async function syncLiveThread(accountId: string, threadId: string) {
  const account = checked(
    await db()
      .from("mail_accounts")
      .select("id,email")
      .eq("id", accountId)
      .single(),
  )!;
  const thread = await gmail<{ messages?: GmailMessage[] }>(
    accountId,
    `threads/${encodeURIComponent(threadId)}?format=full`,
  );
  for (const message of thread.messages || [])
    await ingestLiveMessage(account, message);
}
export async function sendNext() {
  const client = db();
  const msg =
    checked(await client.rpc("claim_outbox"))?.[0] ||
    checked(await client.rpc("claim_notification_outbox"))?.[0];
  if (!msg) return;
  let acceptedByGmail = false;
  let sendAttempted = false;
  try {
    const account = checked(
      await client
        .from("mail_accounts")
        .select("email")
        .eq("id", msg.account_id)
        .single(),
    )!;
    if (msg.opportunity_id && msg.signature_html === null) {
      const settings = await gmail<{
        signature?: string;
        displayName?: string;
      }>(
        msg.account_id,
        `settings/sendAs/${encodeURIComponent(account.email)}`,
      );
      msg.signature_html = settings.signature || "";
      msg.sender_name = settings.displayName || "";
      checked(
        await client
          .from("outbox")
          .update({
            signature_html: msg.signature_html,
            sender_name: msg.sender_name,
          })
          .eq("id", msg.id),
      );
    }
    const files: Attachment[] = [];
    const snapshot: {
      id: string;
      storage_path: string;
      content_hash: string;
      name?: string;
      bucket?: string;
      mime_type?: string;
    }[] = [];
    for (const asset of msg.campaign_asset_snapshot || []) {
      if (!msg.enrollment_id || asset.bucket !== "campaign-assets")
        throw new Error("INVALID_CAMPAIGN_ATTACHMENT");
      const blob = checked(
        await client.storage
          .from("campaign-assets")
          .download(asset.storage_path),
      )!;
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (hash(bytes) !== asset.content_hash)
        throw new Error("ATTACHMENT_HASH_MISMATCH");
      files.push({ name: asset.name, mime: asset.mime_type, bytes });
      snapshot.push(asset);
    }
    for (const id of msg.attachment_ids || []) {
      const frozen = msg.attachment_snapshot?.find(
        (entry: { id: string; bucket?: string }) =>
          entry.id === id && entry.bucket === "case-documents",
      );
      const doc =
        frozen ||
        checked(
          await client
            .from("documents")
            .select("*")
            .eq("id", id)
            .eq("opportunity_id", msg.opportunity_id)
            .eq("status", "approved")
            .single(),
        )!;
      if (!doc.storage_path) throw new Error("DOCUMENT_NOT_APPROVED");
      const file = checked(
        await client.storage.from("case-documents").download(doc.storage_path),
      )!;
      const bytes = Buffer.from(await file.arrayBuffer());
      if (doc.content_hash && hash(bytes) !== doc.content_hash)
        throw new Error("ATTACHMENT_HASH_MISMATCH");
      files.push({
        name: doc.name + (doc.storage_path.endsWith(".pdf") ? ".pdf" : ""),
        mime: file.type,
        bytes,
      });
      snapshot.push({
        id: doc.id,
        name: files[files.length - 1].name,
        bucket: "case-documents",
        mime_type: file.type,
        storage_path: doc.storage_path,
        content_hash: doc.content_hash || hash(files[files.length - 1].bytes),
      });
    }
    for (const id of msg.upload_ids || []) {
      const upload = checked(
        await client
          .from("mail_uploads")
          .select("*")
          .eq("id", id)
          .eq("opportunity_id", msg.opportunity_id)
          .single(),
      )!;
      const blob = checked(
        await client.storage
          .from("gmail-documents")
          .download(upload.storage_path),
      )!;
      const bytes = Buffer.from(decrypt(await blob.text()), "base64");
      if (hash(bytes) !== upload.content_hash)
        throw new Error("ATTACHMENT_HASH_MISMATCH");
      files.push({ name: upload.name, mime: upload.mime_type, bytes });
      snapshot.push({
        id: upload.id,
        name: upload.name,
        bucket: "gmail-documents",
        mime_type: upload.mime_type,
        storage_path: upload.storage_path,
        content_hash: upload.content_hash,
      });
    }
    if (files.reduce((s, f) => s + f.bytes.length, 0) > 18 * 1024 * 1024)
      throw new Error("ATTACHMENTS_TOO_LARGE");
    for (const id of msg.gmail_file_ids || []) {
      const file = checked(
        await client
          .from("gmail_saved_attachments")
          .select("*")
          .eq("id", id)
          .eq("opportunity_id", msg.opportunity_id)
          .in("status", ["received", "approved", "reviewed", "incorporated"])
          .single(),
      )!;
      if (!file.storage_path) throw new Error("DOCUMENT_NOT_APPROVED");
      const blob = checked(
        await client.storage
          .from("gmail-documents")
          .download(file.storage_path),
      )!;
      const bytes = Buffer.from(decrypt(await blob.text()), "base64");
      files.push({ name: file.name, mime: file.mime_type, bytes });
      snapshot.push({
        id: file.id,
        name: file.name,
        bucket: "gmail-documents",
        mime_type: file.mime_type,
        storage_path: file.storage_path,
        content_hash: file.content_hash || hash(bytes),
      });
      if (files.reduce((s, f) => s + f.bytes.length, 0) > 18 * 1024 * 1024)
        throw new Error("ATTACHMENTS_TOO_LARGE");
    }
    if (msg.forward_message_id && msg.forward_file_ids?.length) {
      const source = checked(
        await client
          .from("messages")
          .select("internet_message_id,archive_message_id,conversation_id")
          .eq("id", msg.forward_message_id)
          .single(),
      )!;
      const conversation = checked(
        await client
          .from("conversations")
          .select("opportunity_id")
          .eq("id", source.conversation_id)
          .single(),
      )!;
      if (conversation.opportunity_id !== msg.opportunity_id)
        throw new Error("FOREIGN_FORWARD_SOURCE");
      const sent = checked(
        await client
          .from("outbox")
          .select("attachment_snapshot,upload_ids,gmail_file_ids")
          .eq("message_id_header", source.internet_message_id)
          .eq("opportunity_id", msg.opportunity_id)
          .eq("status", "sent")
          .maybeSingle(),
      );
      for (const id of msg.forward_file_ids) {
        let original = sent?.attachment_snapshot?.find(
          (f: { id: string }) => f.id === id,
        );
        let bucket =
          original?.bucket ||
          ((sent?.upload_ids || []).includes(id) ||
          (sent?.gmail_file_ids || []).includes(id)
            ? "gmail-documents"
            : "case-documents");
        if (!original) {
          original = checked(
            await client
              .from("gmail_saved_attachments")
              .select("*")
              .eq("id", id)
              .eq("archive_message_id", source.archive_message_id)
              .eq("opportunity_id", msg.opportunity_id)
              .single(),
          )!;
          bucket = "gmail-documents";
        }
        if (
          !["case-documents", "gmail-documents"].includes(bucket) ||
          !original.storage_path
        )
          throw new Error("INVALID_FORWARD_ATTACHMENT");
        const blob = checked(
          await client.storage.from(bucket).download(original.storage_path),
        )!;
        const bytes =
          bucket === "gmail-documents"
            ? Buffer.from(decrypt(await blob.text()), "base64")
            : Buffer.from(await blob.arrayBuffer());
        if (hash(bytes) !== original.content_hash)
          throw new Error("ATTACHMENT_HASH_MISMATCH");
        const name = (original.name || "Attachment").replace(
          /[\x00-\x1f\x7f]/g,
          "_",
        );
        files.push({
          name,
          mime: original.mime_type || "application/octet-stream",
          bytes,
        });
        snapshot.push({
          id,
          name,
          bucket,
          mime_type: original.mime_type || "application/octet-stream",
          storage_path: original.storage_path,
          content_hash: original.content_hash,
        });
      }
    }
    if (files.reduce((n, f) => n + f.bytes.length, 0) > 18 * 1024 * 1024)
      throw new Error("ATTACHMENTS_TOO_LARGE");
    checked(
      await client
        .from("outbox")
        .update({ attachment_snapshot: snapshot })
        .eq("id", msg.id),
    );
    let replyTo: string | undefined;
    let references: string | undefined;
    if (msg.conversation_id) {
      let replyQuery = client
        .from("messages")
        .select("internet_message_id,references_header")
        .eq("conversation_id", msg.conversation_id);
      if (msg.reply_message_id)
        replyQuery = replyQuery.eq("id", msg.reply_message_id);
      const latest =
        checked(
          await replyQuery.order("sent_at", { ascending: false }).limit(1),
        ) || [];
      replyTo = latest[0]?.internet_message_id;
      references = [latest[0]?.references_header, replyTo]
        .filter(Boolean)
        .join(" ");
    }
    const unsub = msg.enrollment_id
      ? msg.body.match(/https?:\/\/[^\s]+\/unsubscribe\/[A-Za-z0-9_-]+/)?.[0]
      : undefined;
    const raw = buildMime({
      from: account.email,
      to: msg.to_email,
      cc: msg.cc_emails || [],
      bcc: msg.bcc_emails || [],
      senderName: msg.sender_name || undefined,
      signatureHtml: msg.signature_html || undefined,
      subject: msg.subject,
      body: msg.body,
      messageId: msg.message_id_header,
      inReplyTo: replyTo,
      references,
      unsubscribe: unsub,
      attachments: files,
    });
    // Gmail has no idempotency key. Never blindly retry this POST, even after a timeout.
    sendAttempted = true;
    const result = await gmail<{ id: string; threadId: string }>(
      msg.account_id,
      "messages/send",
      {
        method: "POST",
        body: JSON.stringify({
          raw,
          ...(msg.gmail_thread_id ? { threadId: msg.gmail_thread_id } : {}),
        }),
      },
    );
    acceptedByGmail = true;
    checked(
      await client.rpc("mark_sent", {
        outbox_id: msg.id,
        gmail_id: result.id,
        thread_id: result.threadId,
      }),
    );
  } catch (e) {
    // A quota rejection is a known failure, unlike a timeout or a failed DB
    // update after acceptance. Preserve the request and honor Google's wait.
    if (!acceptedByGmail && isGmailQuotaError(e)) {
      const seconds = Math.max(
        e.retryAfter,
        Math.min(
          3600,
          60 * 2 ** Math.min(Math.max(0, (msg.send_attempts || 1) - 1), 6),
        ),
      );
      checked(
        await client.rpc("defer_gmail_send", {
          message: msg.id,
          seconds,
          error_code: e.code,
        }),
      );
      return;
    }
    checked(
      await client
        .from("outbox")
        .update({
          status: sendAttempted ? "uncertain" : "failed",
          last_error:
            e instanceof GmailError
              ? e.code
              : sendAttempted
                ? "SEND_RESULT_UNCERTAIN"
                : "MAIL_PREPARATION_FAILED",
        })
        .eq("id", msg.id)
        .neq("status", "sent"),
    );
    if (e instanceof GmailError && [401, 403, 429].includes(e.status)) {
      checked(
        await client
          .from("mail_accounts")
          .update({ status: e.status === 401 ? "disconnected" : "restricted" })
          .eq("id", msg.account_id),
      );
      checked(
        await client
          .from("outbox")
          .update({ status: "paused" })
          .eq("account_id", msg.account_id)
          .eq("status", "queued"),
      );
    }
    await alertAdmins(
      `send:${msg.id}`,
      sendAttempted
        ? "An email requires delivery reconciliation"
        : "An email could not be prepared for sending",
    );
  }
}
export async function reconcileUncertain() {
  const client = db();
  const messages =
    checked(
      await client
        .from("outbox")
        .select("id,account_id,message_id_header")
        .or(
          `status.eq.uncertain,and(status.eq.sending,sending_at.lt.${new Date(Date.now() - 300000).toISOString()})`,
        )
        .limit(30),
    ) || [];
  for (const msg of messages) {
    try {
      const result = await gmail<{
        messages?: { id: string; threadId: string }[];
      }>(
        msg.account_id,
        `messages?${new URLSearchParams({ q: `in:sent rfc822msgid:${msg.message_id_header.replace(/[<>]/g, "")}` })}`,
      );
      if (result.messages?.length === 1)
        checked(
          await client.rpc("mark_sent", {
            outbox_id: msg.id,
            gmail_id: result.messages[0].id,
            thread_id: result.messages[0].threadId,
          }),
        );
      else {
        checked(
          await client
            .from("outbox")
            .update({ status: "uncertain" })
            .eq("id", msg.id),
        );
        await alertAdmins(
          `uncertain:${msg.id}`,
          "An email needs manual review before any retry",
        );
      }
    } catch {
      await alertAdmins(
        `reconcile:${msg.account_id}`,
        "Gmail reconciliation needs administrator attention",
      );
    }
  }
}
