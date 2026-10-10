import { cookies } from "next/headers";
import {
  requireUser,
  serviceClient,
  checkDb,
  HttpError,
  jsonError,
} from "@/lib/server/supabase";
import { oauthClient, organization } from "@/lib/server/google";
import { token, hash } from "@/lib/server/crypto";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
export async function GET(request: Request) {
  try {
    const { profile } = await requireUser();
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    if (!gmailHistoryEnabled())
      throw new HttpError(
        503,
        "Apply Gmail migrations and enable GMAIL_HISTORY_ENABLED before connecting accounts",
      );
    const id = new URL(request.url).searchParams.get("organization") || "";
    const org = organization(id);
    const state = token();
    checkDb(
      await serviceClient()
        .from("oauth_states")
        .insert({
          state_hash: hash(state),
          user_id: profile.id,
          organization: id,
          expires_at: new Date(Date.now() + 600000).toISOString(),
        }),
    );
    (await cookies()).set("gmail_oauth_state", hash(state), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/api/gmail",
    });
    return Response.redirect(
      oauthClient(id).generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        state,
        hd: org.domain,
        scope: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
        ],
      }),
    );
  } catch (e) {
    return jsonError(e);
  }
}
