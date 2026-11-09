import { connectGetStatus } from "@/lib/server/mail-accounts/composio-connect/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return connectGetStatus(request, (await context.params).id);
}
