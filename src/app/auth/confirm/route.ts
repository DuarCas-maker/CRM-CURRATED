import type { EmailOtpType } from "@supabase/supabase-js";
import { userClient } from "@/lib/server/supabase";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (token_hash && ["invite", "recovery"].includes(type || "")) {
    const db = await userClient();
    const result = await db.auth.verifyOtp({
      token_hash,
      type: type as EmailOtpType,
    });
    if (!result.error)
      return Response.redirect(
        new URL("/auth/password", process.env.APP_ORIGIN!).toString(),
      );
  }
  return Response.redirect(
    new URL("/login", process.env.APP_ORIGIN!).toString(),
  );
}
