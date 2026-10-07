import { userClient, checkOrigin, jsonError } from "@/lib/server/supabase";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const db = await userClient();
    await db.auth.signOut();
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
