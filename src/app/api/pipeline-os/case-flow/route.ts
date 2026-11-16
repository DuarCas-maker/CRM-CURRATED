import { createCaseFlowHandlers } from "@/lib/server/case-flow";
export const dynamic = "force-dynamic";
const handlers = createCaseFlowHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
