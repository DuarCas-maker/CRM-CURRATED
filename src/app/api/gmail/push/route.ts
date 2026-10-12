import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { readBounded } from "@/lib/server/body";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
import { gmailPushEnabled } from "@/lib/gmail-sync";
import {
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
export async function POST(request: Request) {
  try {
    // Acknowledge any old subscriptions without reading mail or creating jobs.
    if (!gmailPushEnabled()) return new Response(null, { status: 204 });
    if (
      !process.env.GOOGLE_PUBSUB_AUDIENCE ||
      !process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT
    )
      throw new HttpError(503, "Pub/Sub is not configured");
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new HttpError(401, "Authentication required");
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: authorization.slice(7),
      audience: process.env.GOOGLE_PUBSUB_AUDIENCE,
    });
    const claims = ticket.getPayload();
    if (
      claims?.email !== process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT ||
      !claims.email_verified
    )
      throw new HttpError(403, "Invalid Pub/Sub identity");
    const raw = (await readBounded(request, 10000)).toString("utf8");
    const input = z
      .object({
        message: z.object({
          messageId: z.string().max(200),
          data: z.string().max(5000),
        }),
      })
      .parse(JSON.parse(raw));
    const event = z
      .object({ emailAddress: z.email(), historyId: z.string() })
      .parse(
        JSON.parse(Buffer.from(input.message.data, "base64").toString("utf8")),
      );
    const db = serviceClient();
    let query = db
      .from("mail_accounts")
      .select("id")
      .eq("email", event.emailAddress.toLowerCase())
      .eq("status", "connected");
    if (gmailHistoryEnabled()) query = query.eq("live_enabled", true);
    const account = checkDb(await query.maybeSingle());
    if (account)
      checkDb(
        await db.from("jobs").upsert(
          {
            kind: "gmail_sync",
            payload: { account_id: account.id },
            dedupe_key: `pubsub:${input.message.messageId}`,
          },
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        ),
      );
    return new Response(null, { status: 204 });
  } catch (e) {
    return jsonError(e);
  }
}
