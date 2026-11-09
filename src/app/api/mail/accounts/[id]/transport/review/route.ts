import { z } from "zod";
import { requireUser } from "@/lib/server/supabase";
import {
  productRoutingEnabled,
  composioProductOperationEnabled,
} from "@/lib/server/mail-transport/runtime-context";
import {
  TransportAdminError,
  requireTransportAdmin,
  reviewTransportSelection,
  transportAdminJsonError,
} from "@/lib/server/mail-accounts/transport-selection";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { db, profile } = await requireUser();
    requireTransportAdmin(profile);
    const account = z.uuid().safeParse((await context.params).id);
    if (!account.success || new URL(request.url).searchParams.size)
      throw new TransportAdminError("R06_INVALID_INPUT", 400);
    if (!productRoutingEnabled())
      throw new TransportAdminError("R06_NOT_READY", 503);
    return Response.json(
      await reviewTransportSelection(
        db,
        account.data,
        composioProductOperationEnabled,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return transportAdminJsonError(error);
  }
}
