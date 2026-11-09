import { z } from "zod";
import { checkOrigin, requireUser } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import {
  productRoutingEnabled,
  composioProductOperationEnabled,
} from "@/lib/server/mail-transport/runtime-context";
import {
  TransportAdminError,
  requireTransportAdmin,
  readTransportSelection,
  commandTransportSelection,
  transportAdminJsonError,
} from "@/lib/server/mail-accounts/transport-selection";
type Context = { params: Promise<{ id: string }> };
async function accountFor(request: Request, context: Context) {
  const account = z.uuid().safeParse((await context.params).id);
  if (!account.success || new URL(request.url).searchParams.size)
    throw new TransportAdminError("R06_INVALID_INPUT", 400);
  return account.data;
}
export async function GET(request: Request, context: Context) {
  try {
    const { db, profile } = await requireUser();
    requireTransportAdmin(profile);
    const account = await accountFor(request, context);
    if (!productRoutingEnabled())
      throw new TransportAdminError("R06_NOT_READY", 503);
    return Response.json(await readTransportSelection(db, account), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return transportAdminJsonError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    requireTransportAdmin(profile);
    const account = await accountFor(request, context);
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw new TransportAdminError("R06_INVALID_INPUT", 400);
    let body: unknown;
    try {
      body = JSON.parse((await readBounded(request, 16384)).toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new TransportAdminError("R06_INVALID_INPUT", 400);
      throw error;
    }
    if (!productRoutingEnabled())
      throw new TransportAdminError("R06_NOT_READY", 503);
    return Response.json(
      await commandTransportSelection(
        db,
        account,
        body,
        composioProductOperationEnabled,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return transportAdminJsonError(error);
  }
}
