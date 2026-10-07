import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "../domain";
import { serviceClient, checkDb, HttpError } from "./supabase";
import { gmail } from "./google";
import { storeDocument } from "./documents";
import { makeApplicationLink } from "./application-links";
export async function mailAction(
  kind: string,
  p: Record<string, unknown>,
  requestKey: string,
  db: SupabaseClient,
  profile: Profile,
) {
  const service = serviceClient();
  if (kind === "associate_thread") {
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    const input = z
      .object({
        id: z.uuid(),
        opportunity_id: z.uuid(),
        submission_id: z.string().optional(),
      })
      .parse(p);
    const review = checkDb(
      await db.from("mail_review").select("*").eq("id", input.id).single(),
    )!;
    const opportunity = checkDb(
      await db
        .from("opportunities")
        .select("id,handed_off_at")
        .eq("id", input.opportunity_id)
        .single(),
    )!;
    if (input.submission_id) {
      const submission = checkDb(
        await db
          .from("submissions")
          .select("id")
          .eq("id", input.submission_id)
          .eq("opportunity_id", opportunity.id)
          .maybeSingle(),
      );
      if (!submission)
        throw new HttpError(400, "Submission does not belong to this case");
    }
    if (review.reason.toLowerCase().includes("lender") && !input.submission_id)
      throw new HttpError(
        400,
        "Choose the lender submission, not only the case",
      );
    const msg = await gmail<{
      id: string;
      threadId: string;
      payload: { headers: { name: string; value: string }[] };
    }>(
      review.account_id,
      `messages/${review.gmail_message_id}?format=metadata`,
    );
    const existing = checkDb(
      await service
        .from("conversations")
        .select("id,opportunity_id")
        .eq("account_id", review.account_id)
        .eq("gmail_thread_id", msg.threadId)
        .maybeSingle(),
    );
    if (existing && existing.opportunity_id !== opportunity.id)
      throw new HttpError(
        409,
        "Thread is already associated with a different case",
      );
    checkDb(
      await service.from("conversations").upsert(
        {
          account_id: review.account_id,
          gmail_thread_id: msg.threadId,
          opportunity_id: opportunity.id,
          submission_id: input.submission_id || null,
          area:
            opportunity.handed_off_at || input.submission_id
              ? "closer"
              : "seller",
          subject:
            msg.payload.headers.find((h) => h.name.toLowerCase() === "subject")
              ?.value || "(No subject)",
        },
        { onConflict: "account_id,gmail_thread_id", ignoreDuplicates: true },
      ),
    );
    checkDb(
      await service.from("jobs").upsert(
        {
          kind: "gmail_message",
          payload: { account_id: review.account_id, message_id: msg.id },
          dedupe_key: `review:${review.id}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      ),
    );
    checkDb(
      await service
        .from("mail_review")
        .update({ status: "resolved" })
        .eq("id", review.id),
    );
    checkDb(
      await service.from("audit_log").insert({
        actor_id: profile.id,
        entity_type: "mail_review",
        entity_id: review.id,
        action: "associated",
        metadata: {
          opportunity_id: opportunity.id,
          submission_id: input.submission_id || null,
        },
      }),
    );
    return { ok: true };
  }
  if (kind === "import_attachment") {
    const input = z.object({ id: z.uuid(), document_id: z.uuid() }).parse(p);
    const attachment = checkDb(
      await db
        .from("message_attachments")
        .select("*")
        .eq("id", input.id)
        .single(),
    )!;
    const message = checkDb(
      await db
        .from("messages")
        .select("gmail_message_id,conversation_id")
        .eq("id", attachment.message_id)
        .single(),
    )!;
    const conversation = checkDb(
      await db
        .from("conversations")
        .select("*")
        .eq("id", message.conversation_id)
        .single(),
    )!;
    if (
      !checkDb(
        await db.rpc("can_edit_case", { case_id: conversation.opportunity_id }),
      )
    )
      throw new HttpError(403, "Case is read-only");
    const document = checkDb(
      await db
        .from("documents")
        .select("id")
        .eq("id", input.document_id)
        .eq("opportunity_id", conversation.opportunity_id)
        .single(),
    )!;
    if (attachment.size > 20 * 1024 * 1024)
      throw new HttpError(413, "Attachment exceeds 20 MB");
    const file = await gmail<{ data: string }>(
      conversation.account_id,
      `messages/${message.gmail_message_id}/attachments/${attachment.gmail_attachment_id}`,
    );
    const result = await storeDocument(
      new File([Buffer.from(file.data, "base64url")], attachment.name, {
        type: attachment.mime_type,
      }),
      document.id,
      conversation.opportunity_id,
      "gmail_attachment",
      profile.id,
    );
    checkDb(
      await service
        .from("message_attachments")
        .update({ imported_document_id: document.id })
        .eq("id", attachment.id),
    );
    return result;
  }
  if (kind === "request_documents") {
    const input = z
      .object({
        opportunity_id: z.uuid(),
        account_id: z.uuid(),
        body: z.string().min(1).max(10000),
      })
      .parse(p);
    if (
      !checkDb(
        await db.rpc("can_edit_case", { case_id: input.opportunity_id }),
      ) ||
      !checkDb(await db.rpc("can_send", { account: input.account_id }))
    )
      throw new HttpError(403, "Case and sender access required");
    if (process.env.PUBLIC_FORM_ENABLED !== "true")
      throw new HttpError(503, "Public form must be enabled first");
    const opportunity = checkDb(
      await db
        .from("opportunity_workspace")
        .select("*")
        .eq("id", input.opportunity_id)
        .single(),
    )!;
    const link = await makeApplicationLink(opportunity.id, profile.id);
    checkDb(
      await service.from("outbox").upsert(
        {
          account_id: input.account_id,
          opportunity_id: opportunity.id,
          to_email: opportunity.email,
          subject: "Documents for your financing request",
          body: `${input.body}\n\nUpload your documents securely:\n${link}`,
          area: opportunity.handed_off_at ? "closer" : "seller",
          message_id_header: `<${requestKey}@crm.curated.local>`,
          requested_by: profile.id,
          request_key: requestKey,
        },
        { onConflict: "request_key", ignoreDuplicates: true },
      ),
    );
    return { ok: true };
  }
  throw new HttpError(400, "Unknown mail action");
}
