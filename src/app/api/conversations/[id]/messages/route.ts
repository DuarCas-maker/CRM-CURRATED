import { requireUser, checkDb, jsonError } from "@/lib/server/supabase";
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
    checkDb(await db.from("conversations").select("id").eq("id", id).single());
    const paramsUrl = new URL(request.url).searchParams;
    let query = db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100);
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
    if (gmailHistoryEnabled()) {
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
    return Response.json({
      messages: messages.reverse(),
      attachments,
      files: gmailHistoryEnabled() ? await messageFiles(db, messages) : [],
      hasMore: messages.length === 100,
    });
  } catch (e) {
    return jsonError(e);
  }
}
