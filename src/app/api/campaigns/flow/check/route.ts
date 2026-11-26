import { checkOrigin, requireUser } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { checkFlowTemplate } from "@/lib/server/campaign-flow";
import { controlError } from "@/lib/server/campaign-control";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await requireUser();
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return Response.json({ error: "JSON required" }, { status: 400 });
    return Response.json(
      await checkFlowTemplate(
        JSON.parse((await readBounded(request, 100000)).toString("utf8")),
        ctx,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return controlError(e);
  }
}
