import { createMailReviewHandlers } from "@/lib/server/pipeline-mail-review";

export const runtime = "nodejs";
const handlers = createMailReviewHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
