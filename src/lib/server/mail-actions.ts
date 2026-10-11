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
  if (kind === "lender_contact") {
    const input = z
      .object({ lender_id: z.uuid(), email: z.email().max(254) })
      .parse(p);
    checkDb(
      await db.rpc("register_lender_contact", {
        lender: input.lender_id,
        address: input.email,
      }),
    );
    return { ok: true };
  }
  if (kind === "compose_lenders") {
    const input = z
      .object({
        opportunity_id: z.uuid(),
        account_id: z.uuid(),
        process_id: z.uuid(),
        targets: z
          .array(
            z.object({
              lender_id: z.uuid(),
              submission_id: z.uuid().optional(),
              email: z.email().max(254),
            }),
          )
          .min(1)
          .max(20),
        subject: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((v) => !/[\r\n]/.test(v)),
        body: z.string().trim().min(1).max(10000),
        attachment_ids: z.array(z.uuid()).max(10).default([]),
        gmail_file_ids: z.array(z.uuid()).max(10).default([]),
      })
      .parse(p);
    return checkDb(
      await db.rpc("queue_lender_emails", {
        case_id: input.opportunity_id,
        account: input.account_id,
        process: input.process_id,
        targets: input.targets,
        subject_text: input.subject,
        body_text: input.body,
        files: input.attachment_ids,
        gmail_files: input.gmail_file_ids,
        request: requestKey,
      }),
    );
  }
  if (kind === "compose_email") {
    const input = z
      .object({
        opportunity_id: z.uuid(),
        account_id: z.uuid(),
        to_email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        subject: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((v) => !/[\r\n]/.test(v)),
        body: z.string().trim().min(1).max(10000),
        attachment_ids: z.array(z.uuid()).max(10).default([]),
        gmail_file_ids: z.array(z.uuid()).max(10).default([]),
      })
      .parse(p);
    const id = checkDb(
      await db.rpc("queue_manual_email", {
        case_id: input.opportunity_id,
        account: input.account_id,
        recipient: input.to_email,
        subject_text: input.subject,
        body_text: input.body,
        files: input.attachment_ids,
        gmail_files: input.gmail_file_ids,
        request: requestKey,
      }),
    );
    return { ok: true, id };
  }
  if (kind === "reply") {
    const input = z
      .object({
        conversation_id: z.uuid(),
        reply_message_id: z.uuid().optional(),
        to_email: z.email().max(254).optional(),
        cc_emails: z.array(z.email().max(254)).max(20).default([]),
        lender_id: z.uuid().optional(),
        body: z.string().min(1).max(10000),
        account_id: z.uuid().optional(),
        attachment_ids: z.array(z.uuid()).max(10).default([]),
        gmail_file_ids: z.array(z.uuid()).max(10).default([]),
      })
      .parse(p);
    const co = checkDb(
      await db
        .from("conversations")
        .select("*")
        .eq("id", input.conversation_id)
        .single(),
    )!;
    if (
      !checkDb(
        await db.rpc("can_area", { case_id: co.opportunity_id, area: co.area }),
      ) ||
      !checkDb(await db.rpc("can_edit_case", { case_id: co.opportunity_id }))
    )
      throw new HttpError(403, "Case is read-only");
    const o = checkDb(
      await db
        .from("opportunities")
        .select("contact_id,company_id,primary_account_id,handed_off_at")
        .eq("id", co.opportunity_id)
        .single(),
    )!;
    const account = input.account_id || o.primary_account_id || co.account_id;
    if (!checkDb(await db.rpc("can_send", { account })))
      throw new HttpError(403, "Sender permission required");
    const contact = checkDb(
      await db.from("contacts").select("email").eq("id", o.contact_id).single(),
    )!;
    let recipient = co.recipient_email || contact.email;
    if (co.submission_id) {
      const sub = checkDb(
        await db
          .from("submissions")
          .select("lender_id")
          .eq("id", co.submission_id)
          .single(),
      )!;
      recipient = checkDb(
        await db
          .from("lenders")
          .select("email")
          .eq("id", sub.lender_id)
          .single(),
      )!.email;
    } else {
      const latest = checkDb(
        await db
          .from("messages")
          .select("sender")
          .eq("conversation_id", co.id)
          .eq("direction", "inbound")
          .eq("nature", "personal")
          .order("sent_at", { ascending: false })
          .limit(1),
      );
      const possible = latest?.[0]?.sender;
      if (possible && possible !== recipient) {
        const peer = checkDb(
          await db
            .from("contacts")
            .select("id")
            .eq("email", possible)
            .maybeSingle(),
        );
        if (
          peer &&
          o.company_id &&
          checkDb(
            await db
              .from("company_contacts")
              .select("contact_id")
              .eq("company_id", o.company_id)
              .eq("contact_id", peer.id)
              .in("relationship", ["primary", "contact", "broker"])
              .maybeSingle(),
          )
        )
          recipient = possible;
      }
    }
    let replyMessage: {
      id: string;
      sender: string;
      participants: { email: string; role: string }[];
    } | null = null;
    if (input.reply_message_id)
      replyMessage = checkDb(
        await db
          .from("messages")
          .select("id,sender,participants")
          .eq("id", input.reply_message_id)
          .eq("conversation_id", co.id)
          .single(),
      );
    let submissionId = co.submission_id;
    if (input.to_email || input.cc_emails.length || input.lender_id) {
      const team =
        checkDb(await service.from("gmail_team_members").select("email")) || [];
      const accounts =
        checkDb(await service.from("mail_accounts").select("email")) || [];
      const allowed = new Set(
        [...team, ...accounts].map((t) => t.email.toLowerCase()),
      );
      if (input.lender_id) {
        if (
          !checkDb(
            await db.rpc("can_area", {
              case_id: co.opportunity_id,
              area: "closer",
            }),
          )
        )
          throw new HttpError(403, "Closer access required");
        const route = checkDb(
          await db
            .from("conversation_lenders")
            .select("lender_id")
            .eq("conversation_id", co.id)
            .eq("lender_id", input.lender_id)
            .maybeSingle(),
        );
        if (!route)
          throw new HttpError(400, "Confirm this thread's lender association");
        const peers =
          checkDb(
            await db
              .from("lender_contacts")
              .select("email")
              .eq("lender_id", input.lender_id),
          ) || [];
        peers.forEach((p) => allowed.add(p.email));
        const subs =
          checkDb(
            await db
              .from("submissions")
              .select("id,process_id")
              .eq("opportunity_id", co.opportunity_id)
              .eq("lender_id", input.lender_id),
          ) || [];
        const matching = subs.filter((s) => s.process_id === co.process_id);
        if (matching.length !== 1)
          throw new HttpError(
            409,
            "Selecciona una evaluación del lender para este proceso antes de responder.",
          );
        submissionId = matching[0].id;
      } else if (co.submission_id) {
        const sub = checkDb(
          await db
            .from("submissions")
            .select("lender_id")
            .eq("id", co.submission_id)
            .single(),
        )!;
        (
          checkDb(
            await db
              .from("lender_contacts")
              .select("email")
              .eq("lender_id", sub.lender_id),
          ) || []
        ).forEach((p) => allowed.add(p.email));
      } else {
        allowed.add(contact.email);
        if (o.company_id) {
          const links =
            checkDb(
              await db
                .from("company_contacts")
                .select("contact_id")
                .eq("company_id", o.company_id)
                .in("relationship", ["primary", "contact", "broker"]),
            ) || [];
          if (links.length)
            (
              checkDb(
                await db
                  .from("contacts")
                  .select("email")
                  .in(
                    "id",
                    links.map((l) => l.contact_id),
                  ),
              ) || []
            ).forEach((p) => allowed.add(p.email));
        }
      }
      recipient = (
        input.to_email ||
        replyMessage?.sender ||
        recipient
      ).toLowerCase();
      if (
        !allowed.has(recipient) ||
        input.cc_emails.some((e) => !allowed.has(e.toLowerCase()))
      )
        throw new HttpError(
          400,
          "Confirma los destinatarios: no se permite añadir otro lender o cliente a esta respuesta.",
        );
    }
    const cc = [...new Set(input.cc_emails.map((e) => e.toLowerCase()))].filter(
      (e) => e !== recipient,
    );
    for (const id of input.attachment_ids)
      checkDb(
        await db
          .from("documents")
          .select("id")
          .eq("id", id)
          .eq("opportunity_id", co.opportunity_id)
          .eq("status", "approved")
          .single(),
      );
    for (const id of input.gmail_file_ids)
      checkDb(
        await db
          .from("gmail_saved_attachments")
          .select("id")
          .eq("id", id)
          .eq("opportunity_id", co.opportunity_id)
          .eq("status", "approved")
          .not("storage_path", "is", null)
          .single(),
      );
    const message = {
      account_id: account,
      opportunity_id: co.opportunity_id,
      submission_id: submissionId,
      conversation_id: co.id,
      to_email: recipient,
      cc_emails: cc,
      reply_message_id: replyMessage?.id || null,
      process_id: co.process_id,
      subject: co.subject,
      body: input.body,
      area: o.handed_off_at ? "closer" : co.area,
      attachment_ids: input.attachment_ids,
      gmail_file_ids: input.gmail_file_ids,
      message_id_header: `<${requestKey}@crm.curated.local>`,
      requested_by: profile.id,
      request_key: requestKey,
      gmail_thread_id: account === co.account_id ? co.gmail_thread_id : null,
    };
    const previous = checkDb(
      await service
        .from("outbox")
        .select("*")
        .eq("request_key", requestKey)
        .maybeSingle(),
    );
    const identity = {
      requested_by: profile.id,
      opportunity_id: co.opportunity_id,
      conversation_id: co.id,
      subject: co.subject,
      body: message.body,
      account_id: account,
      to_email: recipient,
      submission_id: submissionId,
      process_id: co.process_id || null,
      reply_message_id: replyMessage?.id || null,
      cc_emails: cc,
      attachment_ids: input.attachment_ids,
      gmail_file_ids: input.gmail_file_ids,
    };
    const same = (stored: Record<string, unknown>) =>
      Object.entries(identity).every(
        ([key, value]) =>
          JSON.stringify(stored[key] ?? null) === JSON.stringify(value ?? null),
      );
    if (previous && !same(previous))
      throw new HttpError(409, "Request key reused with different input");
    checkDb(
      await service
        .from("outbox")
        .upsert(message, { onConflict: "request_key", ignoreDuplicates: true }),
    );
    const accepted = checkDb(
      await service
        .from("outbox")
        .select("*")
        .eq("request_key", requestKey)
        .single(),
    )!;
    if (!same(accepted))
      throw new HttpError(409, "Request key reused with different input");
    return { ok: true };
  }
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
