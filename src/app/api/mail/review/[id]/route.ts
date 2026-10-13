import { z } from "zod";
import {
  requireUser,
  serviceClient,
  checkDb,
  jsonError,
} from "@/lib/server/supabase";
import { decrypt } from "@/lib/server/crypto";
import type { MailSnapshot } from "@/lib/gmail-history";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await requireUser();
    const id = z.uuid().parse((await params).id);
    const r = checkDb(
      await db
        .from("mail_review")
        .select("account_id,gmail_message_id")
        .eq("id", id)
        .single(),
    )!;
    const archive = checkDb(
      await serviceClient()
        .from("gmail_archive_messages")
        .select("encrypted_payload,gmail_thread_id")
        .eq("account_id", r.account_id)
        .eq("gmail_message_id", r.gmail_message_id)
        .single(),
    )!;
    const snapshot = JSON.parse(
      decrypt(archive.encrypted_payload),
    ) as MailSnapshot;
    let messages;
    let hasMore = false;
    let cursor = null;
    const paramsUrl = new URL(request.url).searchParams;
    if (paramsUrl.get("thread") === "true") {
      let query = serviceClient()
        .from("gmail_archive_messages")
        .select("id,sent_at,encrypted_payload")
        .eq("account_id", r.account_id)
        .eq("gmail_thread_id", archive.gmail_thread_id)
        .order("sent_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(51);
      if (paramsUrl.get("before")) {
        const before = z.iso
          .datetime({ offset: true })
          .parse(paramsUrl.get("before"));
        const messageId = z.uuid().parse(paramsUrl.get("cursor"));
        query = query.or(
          `sent_at.lt.${before},and(sent_at.eq.${before},id.lt.${messageId})`,
        );
      }
      const rows = checkDb(await query) || [];
      const page = rows.slice(0, 50);
      hasMore = rows.length > 50;
      const last = page.at(-1);
      cursor = last ? { before: last.sent_at, cursor: last.id } : null;
      messages = page.map((row) => {
        const mail = JSON.parse(decrypt(row.encrypted_payload)) as MailSnapshot;
        return {
          id: row.id,
          sender: mail.participants.find((p) => p.role === "from")?.email || "",
          sent_at: mail.sent_at,
          direction: mail.direction,
          body: mail.body,
          participants: mail.participants,
          subject: mail.subject,
          attachments: mail.attachments.map(
            ({ data: _data, ...attachment }) => attachment,
          ),
        };
      });
    }
    return Response.json(
      {
        body: snapshot.body,
        ...(messages ? { messages, hasMore, cursor } : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
