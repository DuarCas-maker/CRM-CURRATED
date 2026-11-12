import { loadPipelineBoard } from "@/lib/server/pipeline-os-module";
import { pipelineBoardResponse } from "@/lib/server/pipeline-os-http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return pipelineBoardResponse(request, loadPipelineBoard);
}
