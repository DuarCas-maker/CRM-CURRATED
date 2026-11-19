import { z } from "zod";
import {
  parseTaskOverviewQuery,
  type TaskOverviewQuery,
  type TasksOverview,
} from "../pipeline-os/tasks-overview";
import { jsonError } from "./supabase";

export async function tasksOverviewResponse(
  request: Request,
  load: (query: TaskOverviewQuery) => Promise<TasksOverview>,
) {
  try {
    const query = parseTaskOverviewQuery(new URL(request.url).searchParams);
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
