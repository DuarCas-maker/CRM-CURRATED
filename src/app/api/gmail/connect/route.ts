import { cookies } from "next/headers";
import { requireUser, HttpError } from "@/lib/server/supabase";
import { oauthClient, organization } from "@/lib/server/google";
import { token, hash } from "@/lib/server/crypto";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
import { parseBrandOAuthIntent } from "@/lib/brand-management";
import {
  BrandError,
  brandResult,
  brandJsonError,
} from "@/lib/server/brand-actions";
export async function GET(request: Request) {
  try {
    const { profile, db } = await requireUser();
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    if (!gmailHistoryEnabled())
      throw new HttpError(
        503,
        "Apply Gmail migrations and enable GMAIL_HISTORY_ENABLED before connecting accounts",
      );
    const params = new URL(request.url).searchParams;
    const id = params.get("organization") || "";
    const org = organization(id);
    const number = (key: string) => {
      const value = params.get(key);
      return value && /^[1-9][0-9]*$/.test(value) ? Number(value) : null;
    };
    const intent = parseBrandOAuthIntent({
      mode: params.get("mode"),
      brand_id: params.get("brand_id"),
      expected_brand_revision: number("expected_brand_revision"),
      account_id: params.get("account_id") || null,
      expected_account_revision: number("expected_account_revision"),
    });
    if (!intent) throw new BrandError("BRAND_INVALID_INPUT", 400);
    const state = token();
    brandResult(
      await db.rpc("brand_oauth_begin", {
        state_hash: hash(state),
        organization_id: id,
        intent,
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
    return brandJsonError(e);
  }
}
