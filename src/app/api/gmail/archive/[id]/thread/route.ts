import { z } from "zod";
import {
  requireUser,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { decrypt } from "@/lib/server/crypto";
import { teamLabels } from "@/lib/server/gmail-team";
import type { MailSnapshot } from "@/lib/gmail-history";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = z.uuid().parse((await params).id);
    const { db, profile } = await requireUser();

    if (
      profile.role !== "superadmin" &&
      !(
        checkDb(
          await db
            .from("case_events")
            .select("id")
            .eq("archive_message_id", id)
            .limit(1),
        ) || []
      ).length
    )
      throw new HttpError(403, "Message access required");
    const anchor = checkDb(
      await db
        .from("mail_archive_visible")
        .select("account_id,gmail_thread_id")
        .eq("id", id)
        .single(),
    )!;
    const queryParams = new URL(request.url).searchParams;
    let query = db
      .from("mail_archive_visible")
      .select("id,sent_at,encrypted_payload")
      .eq("account_id", anchor.account_id)
      .eq("gmail_thread_id", anchor.gmail_thread_id)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(51);
    if (queryParams.get("before")) {
      const before = z.iso
        .datetime({ offset: true })
        .parse(queryParams.get("before"));
      const cursor = z.uuid().parse(queryParams.get("cursor"));
      query = query.or(
        `sent_at.lt.${before},and(sent_at.eq.${before},id.lt.${cursor})`,
      );
    }
    const rows = checkDb(await query) || [];
    const visible = rows.slice(0, 50);
    const snapshots = visible.map((m) => ({
      ...(JSON.parse(decrypt(m.encrypted_payload)) as MailSnapshot),
      archive_id: m.id,
    }));
    const teams = await teamLabels(
      snapshots.flatMap((m) => m.participants.map((p) => p.email)),
    );
    const messages = snapshots
      .map((m) => ({
        ...m,
        participants: m.participants.map((p) => ({
          ...p,
          team: teams.get(p.email.toLowerCase()),
        })),
        attachments: m.attachments.map(({ data: _data, ...a }) => a),
      }))
      .reverse();
    const last = rows.slice(0, 50).at(-1);
    return Response.json(
      {
        messages,
        hasMore: rows.length > 50,
        cursor: last ? { before: last.sent_at, cursor: last.id } : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
