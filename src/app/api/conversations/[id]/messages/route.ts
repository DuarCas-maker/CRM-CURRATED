import {
  requireUser,
  checkDb,
  jsonError,
  serviceClient,
} from "@/lib/server/supabase";
import { z } from "zod";
import { teamLabels } from "@/lib/server/gmail-team";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
import { messageFiles } from "@/lib/server/mail-manager";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await requireUser();
    const id = z.uuid().parse((await params).id);
    const conversation = checkDb(
      await db
        .from("conversations")
        .select("id,opportunity_id")
        .eq("id", id)
        .single(),
    )!;
    const paramsUrl = new URL(request.url).searchParams;
    const selectedIds = paramsUrl.has("ids")
      ? z
          .array(z.uuid())
          .min(1)
          .max(100)
          .parse(paramsUrl.get("ids")!.split(","))
      : null;
    let query = db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100);
    if (selectedIds) query = query.in("id", selectedIds);
    const search = (paramsUrl.get("q") || "")
      .replace(/[%,().\\]/g, " ")
      .slice(0, 150)
      .trim();
    if (search)
      query = query.or(`body.ilike.%${search}%,sender.ilike.%${search}%`);
    if (paramsUrl.get("before")) {
      const before = z
        .string()
        .datetime({ offset: true })
        .parse(paramsUrl.get("before"));
      const cursor = z.uuid().parse(paramsUrl.get("cursor"));
      query = query.or(
        `sent_at.lt.${before},and(sent_at.eq.${before},id.lt.${cursor})`,
      );
    }
    const messages = checkDb(await query) || [];
    {
      const labels = await teamLabels(messages.map((m) => m.sender));
      for (const message of messages)
        message.sender_team = labels.get(message.sender.toLowerCase());
    }
    const attachments = messages.length
      ? checkDb(
          await db
            .from("message_attachments")
            .select("*")
            .in(
              "message_id",
              messages.map((m) => m.id),
            ),
        ) || []
      : [];
    return Response.json(
      {
        messages: messages.reverse(),
        attachments,
        files: gmailHistoryEnabled() ? await messageFiles(db, messages) : [],
        // The user's RLS-protected conversation lookup above authorizes this exact case/thread.
        sends:
          checkDb(
            await serviceClient()
              .from("outbox")
              .select(
                "id,conversation_id,reply_message_id,account_id,to_email,cc_emails,body,subject,status,message_id_header,gmail_message_id,created_at,sent_at,last_error",
              )
              .eq("opportunity_id", conversation.opportunity_id)
              .eq("conversation_id", id)
              .not("reply_message_id", "is", null)
              .order("created_at", { ascending: false })
              .limit(100),
          ) || [],
        hasMore: !selectedIds && messages.length === 100,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
