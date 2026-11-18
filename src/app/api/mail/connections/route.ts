import { simpleMailHttp } from "@/lib/server/mail-accounts/onboarding/http";
export const GET = (request: Request) => simpleMailHttp(request);
export const POST = (request: Request) => simpleMailHttp(request);
