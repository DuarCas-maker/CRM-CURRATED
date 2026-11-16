import { loadMasterPipeline } from "@/lib/server/pipeline-master";
import { masterPipelineResponse } from "@/lib/server/pipeline-master-http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return masterPipelineResponse(request, loadMasterPipeline);
}
