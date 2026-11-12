import { z } from "zod";
import { checkOrigin, requireUser } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { requireComposioAdmin } from "@/lib/server/mail-accounts/composio-binding";
import {
  verificationSetupEnabled,
  verificationSetupPorts,
  verificationSetupPage,
  verificationSetupCommand,
  verificationSetupJsonError,
  VerificationSetupError,
} from "@/lib/server/mail-accounts/composio-verification-setup";

type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context, write: boolean) {
  try {
    if (!verificationSetupEnabled())
      throw new VerificationSetupError("SETUP_UNAVAILABLE", 404);
    if (write) checkOrigin(request);
    const { db, profile } = await requireUser();
    requireComposioAdmin(profile);
    const account = z.uuid().safeParse((await context.params).id);
    if (!account.success || new URL(request.url).searchParams.size)
      throw new VerificationSetupError("SETUP_INVALID_INPUT", 400);
    let body: unknown;
    if (write) {
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        throw new VerificationSetupError("SETUP_INVALID_INPUT", 400);
      try {
        body = JSON.parse((await readBounded(request, 8192)).toString("utf8"));
      } catch (e) {
        if (e instanceof SyntaxError)
          throw new VerificationSetupError("SETUP_INVALID_INPUT", 400);
        throw e;
      }
    }
    const ports = verificationSetupPorts(db);
    return Response.json(
      write
        ? await verificationSetupCommand(ports, account.data, body)
        : await verificationSetupPage(ports, account.data),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return verificationSetupJsonError(error);
  }
}
export const GET = (request: Request, context: Context) =>
  handle(request, context, false);
export const POST = (request: Request, context: Context) =>
  handle(request, context, true);
