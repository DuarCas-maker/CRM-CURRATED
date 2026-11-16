import {
  caseProgressResponse,
  loadCaseProgress,
} from "@/lib/server/case-progress";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return caseProgressResponse(request, loadCaseProgress);
}
