import { loadWorkspace } from "@/lib/server/workspace";
import { jsonError } from "@/lib/server/supabase";
export async function GET(request: Request) {
  try {
    return Response.json(
      await loadWorkspace(new URL(request.url).searchParams),
    );
  } catch (e) {
    return jsonError(e);
  }
}
