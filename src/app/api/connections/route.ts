import { connectionsGet } from "@/lib/server/connections";
export async function GET(request: Request) {
  return connectionsGet(request);
}
