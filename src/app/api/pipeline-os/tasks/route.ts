import { loadTasksOverview } from "@/lib/server/pipeline-tasks";
import { tasksOverviewResponse } from "@/lib/server/pipeline-tasks-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return tasksOverviewResponse(request, loadTasksOverview);
}
