import { z } from "zod";
import {
  parseMasterQuery,
  type MasterQuery,
  type MasterDashboard,
} from "../pipeline-os/master-pipeline";
import { jsonError } from "./supabase";
export async function masterPipelineResponse(
  request: Request,
  load: (q: MasterQuery) => Promise<MasterDashboard>,
) {
  try {
    const query = parseMasterQuery(new URL(request.url).searchParams);
    return Response.json(await load(query), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Filtros inválidos / Invalid filters" },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    return jsonError(e);
  }
}
