import {
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { hash } from "@/lib/server/crypto";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new HttpError(404, "Invalid link");
    const db = serviceClient();
    const row = checkDb(
      await db
        .from("unsubscribe_links")
        .select("contact_id")
        .eq("token_hash", hash(token))
        .maybeSingle(),
    );
    if (!row) throw new HttpError(404, "Invalid link");
    checkDb(
      await db.rpc("suppress_contact", {
        contact: row.contact_id,
        reason: "unsubscribe",
      }),
    );
    return new Response(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed · Curated Financial</title><body style="font:16px Arial;padding:40px"><h1>You have been unsubscribed.</h1><p>You will no longer receive outreach emails from Curated Financial.</p></body></html>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
