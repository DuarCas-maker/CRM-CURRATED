import { connectAction } from "@/lib/server/mail-accounts/composio-connect/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const p = await context.params;
  return connectAction(request, p.id, p.action);
}
