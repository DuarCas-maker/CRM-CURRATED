import {
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { decrypt } from "@/lib/server/crypto";
import type { MailSnapshot } from "@/lib/gmail-history";
import { z } from "zod";
import { teamLabels } from "@/lib/server/gmail-team";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      throw new HttpError(400, "Invalid message");
    const { db, profile } = await requireUser();
    if (profile.role !== "superadmin") {
      const evidence = checkDb(
        await db
          .from("case_events")
          .select("id")
          .eq("archive_message_id", id)
          .limit(1),
      );
      if (!evidence?.length)
        throw new HttpError(403, "Message access required");
    }
    const archive = checkDb(
      await serviceClient()
        .from("gmail_archive_messages")
        .select("encrypted_payload")
        .eq("id", id)
        .single(),
    )!;
    const snapshot = JSON.parse(
      decrypt(archive.encrypted_payload),
    ) as MailSnapshot;
    const teams = await teamLabels(snapshot.participants.map((p) => p.email));
    return Response.json(
      {
        ...snapshot,
        participants: snapshot.participants.map((p) => ({
          ...p,
          team: teams.get(p.email.toLowerCase()),
        })),
        attachments: snapshot.attachments.map(
          ({ data: _data, ...file }) => file,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
