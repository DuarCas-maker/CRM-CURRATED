import { checkOrigin, requireUser } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { campaignSenderSignature } from "@/lib/server/campaign-signature";
import { controlError } from "@/lib/server/campaign-control";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await requireUser();
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return Response.json(
        { error: "JSON required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(
      await campaignSenderSignature(
        JSON.parse((await readBounded(request, 5000)).toString("utf8")),
        ctx,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return controlError(e);
  }
}
