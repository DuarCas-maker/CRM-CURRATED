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
  _request: Request,
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
        .select("encrypted_payload")
        .eq("account_id", r.account_id)
        .eq("gmail_message_id", r.gmail_message_id)
        .single(),
    )!;
    const snapshot = JSON.parse(
      decrypt(archive.encrypted_payload),
    ) as MailSnapshot;
    return Response.json(
      { body: snapshot.body },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
