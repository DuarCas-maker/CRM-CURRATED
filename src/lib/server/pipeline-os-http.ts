import { z } from "zod";
import {
  parsePipelineQuery,
  type PipelineBoard,
  type PipelineQuery,
} from "../pipeline-os/module";
import { jsonError } from "./supabase";

export async function pipelineBoardResponse(
  request: Request,
  load: (query: PipelineQuery) => Promise<PipelineBoard>,
) {
  try {
    const query = parsePipelineQuery(new URL(request.url).searchParams);
    return Response.json(await load(query), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Filtros inválidos / Invalid filters" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
