import { z } from "zod";
import {
  requireUser,
  HttpError,
  jsonError,
  checkDb,
} from "@/lib/server/supabase";
import { AI_SERVICE_KEYS, type AiService } from "@/lib/ai-usage";
import { aiApiKey } from "@/lib/server/ai-usage";

export async function GET(request: Request) {
  try {
    const { db, profile } = await requireUser();
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    const days = z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .parse(new URL(request.url).searchParams.get("days") || "30");
    const result = await db.rpc("ai_usage_summary", { days });
    if (
      result.error &&
      ["PGRST202", "42883", "42P01"].includes(result.error.code)
    )
      throw new HttpError(
        503,
        "Aplica 041_ai_service_usage.sql para consultar el consumo. / Apply 041_ai_service_usage.sql to view usage.",
      );
    return Response.json(
      {
        ...checkDb(result),
        configured: Object.fromEntries(
          (Object.keys(AI_SERVICE_KEYS) as AiService[]).map((service) => [
            service,
            !!aiApiKey(service),
          ]),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: "Invalid date range" }, { status: 400 });
    return jsonError(error);
  }
}
