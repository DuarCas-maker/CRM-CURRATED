import { cookies } from "next/headers";
import {
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { oauthClient, organization } from "@/lib/server/google";
import { hash, encrypt } from "@/lib/server/crypto";
export async function GET(request: Request) {
  try {
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
    const record = checkDb(
      await db
        .from("oauth_states")
        .update({ used_at: new Date().toISOString() })
        .eq("state_hash", hash(state))
        .eq("user_id", profile.id)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("organization")
        .maybeSingle(),
    );
    if (!record) throw new HttpError(400, "Authorization expired");
    const org = organization(record.organization);
    const client = oauthClient(org.id);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token || !tokens.refresh_token)
      throw new HttpError(400, "Google did not grant offline access");
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
    const account = checkDb(
      await db
        .from("mail_accounts")
        .upsert(
          {
            email: claims.email.toLowerCase(),
            organization: org.id,
            status: "connected",
          },
          { onConflict: "email" },
        )
        .select("id")
        .single(),
    )!;
    checkDb(
      await db.from("mail_credentials").upsert(
        {
          account_id: account.id,
          encrypted_refresh_token: encrypt(tokens.refresh_token),
        },
        { onConflict: "account_id" },
      ),
    );
    checkDb(
      await db.from("mail_permissions").upsert({
        account_id: account.id,
        user_id: profile.id,
        can_send: true,
      }),
    );
    checkDb(
      await db.from("jobs").insert({
        kind: "gmail_watch",
        payload: { account_id: account.id },
        dedupe_key: `watch:connect:${account.id}:${Date.now()}`,
      }),
    );
    checkDb(
      await db.from("audit_log").insert({
        actor_id: profile.id,
        entity_type: "mail_account",
        entity_id: account.id,
        action: "connected",
      }),
    );
    // Queued jobs are safe to resume; uncertain sends always require reconciliation.
    checkDb(
      await db
        .from("outbox")
        .update({ status: "queued" })
        .eq("account_id", account.id)
        .eq("status", "paused"),
    );
    (await cookies()).delete("gmail_oauth_state");
    return Response.redirect(`${process.env.APP_ORIGIN}/`);
  } catch (e) {
    return jsonError(e);
  }
}
