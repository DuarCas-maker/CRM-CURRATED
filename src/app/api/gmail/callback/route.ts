import { cookies } from "next/headers";
import { gmailPushEnabled } from "@/lib/gmail-sync";
import { requireUser, serviceClient, HttpError } from "@/lib/server/supabase";
import { oauthClient, organization } from "@/lib/server/google";
import { hash, encrypt } from "@/lib/server/crypto";
import {
  brandResult,
  brandJsonError,
  BrandError,
} from "@/lib/server/brand-actions";
export async function GET(request: Request) {
  try {
    const pushEnabled = gmailPushEnabled();
    const { profile } = await requireUser();
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (
      !state ||
      !code ||
      (await cookies()).get("gmail_oauth_state")?.value !== hash(state)
    )
      throw new HttpError(400, "Invalid authorization state");
    const db = serviceClient();
    const record = brandResult(
      await db.rpc("brand_oauth_claim", {
        state_hash: hash(state),
        actor_id: profile.id,
      }),
    ) as { organization: string } | null;
    if (!record?.organization) throw new BrandError("BRAND_UNAVAILABLE", 503);
    const org = organization(record.organization);
    const client = oauthClient(org.id);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token || !tokens.refresh_token)
      throw new HttpError(400, "Google did not grant offline access");
    const scopes = new Set((tokens.scope || "").split(/\s+/));
    if (
      !scopes.has("https://www.googleapis.com/auth/gmail.readonly") ||
      !scopes.has("https://www.googleapis.com/auth/gmail.send")
    )
      throw new HttpError(
        400,
        "Authorize both Gmail reading and sending to connect this account",
      );
    const verified = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: org.clientId,
    });
    const claims = verified.getPayload();
    if (!claims?.email_verified || claims.hd !== org.domain || !claims.email)
      throw new HttpError(
        403,
        "Account is outside the configured organization",
      );
    brandResult(
      await db.rpc("brand_oauth_finish", {
        state_hash: hash(state),
        actor_id: profile.id,
        mailbox_email: claims.email.toLowerCase(),
        encrypted_token: encrypt(tokens.refresh_token),
        watch_enabled: pushEnabled,
      }),
    );
    // Reauthorization never implicitly resumes historical campaigns or paused sends.
    (await cookies()).delete("gmail_oauth_state");
    return Response.redirect(`${process.env.APP_ORIGIN}/`);
  } catch (e) {
    return brandJsonError(e);
  }
}
