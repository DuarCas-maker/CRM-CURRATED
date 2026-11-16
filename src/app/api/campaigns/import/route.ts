import { checkOrigin, requireUser } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import {
  importCampaignError,
  readImportCampaign,
  writeImportCampaign,
} from "@/lib/server/campaign-import";
export async function GET(request: Request) {
  try {
    return Response.json(
      await readImportCampaign(new URL(request.url), await requireUser()),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return importCampaignError(e);
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
    const body = JSON.parse(
      (await readBounded(request, 350000)).toString("utf8"),
    );
    return Response.json(await writeImportCampaign(body, ctx), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return importCampaignError(e);
  }
}
