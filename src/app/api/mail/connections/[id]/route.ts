import { simpleMailHttp } from "@/lib/server/mail-accounts/onboarding/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return simpleMailHttp(request, (await params).id);
}
