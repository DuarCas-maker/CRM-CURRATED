import { simpleMailHttp } from "@/lib/server/mail-accounts/onboarding/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return simpleMailHttp(request, (await params).id, "disconnect");
}
