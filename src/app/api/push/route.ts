import { requireUser, HttpError, jsonError } from "@/lib/server/supabase";
export async function GET() {
  try {
    await requireUser();
    if (!process.env.VAPID_PUBLIC_KEY)
      throw new HttpError(
        503,
        "Push is not configured; in-app notifications remain available.",
      );
    return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  } catch (e) {
    return jsonError(e);
  }
}
