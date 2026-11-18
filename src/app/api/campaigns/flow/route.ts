import { checkOrigin, requireUser } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { readFlow, launchFlow } from "@/lib/server/campaign-flow";
import { controlError } from "@/lib/server/campaign-control";
export async function GET(request: Request) {
  try {
    return Response.json(
      await readFlow(new URL(request.url), await requireUser()),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return controlError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await requireUser();
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return Response.json({ error: "JSON required" }, { status: 400 });
    return Response.json(
      await launchFlow(
        JSON.parse((await readBounded(request, 100000)).toString("utf8")),
        ctx,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return controlError(e);
  }
}
