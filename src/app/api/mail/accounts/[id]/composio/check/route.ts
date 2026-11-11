import { z } from "zod";
import { requireUser, checkOrigin } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import {
  ComposioBindingError,
  requireComposioAdmin,
  bindingJsonError,
} from "@/lib/server/mail-accounts/composio-binding";
import {
  bindingCheckV2,
  bindingV2Ports,
} from "@/lib/server/mail-accounts/composio-binding-v2";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    requireComposioAdmin(profile);
    const account = z.uuid().safeParse((await context.params).id);
    if (
      !account.success ||
      new URL(request.url).searchParams.size ||
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
    let body: unknown;
    try {
      body = JSON.parse((await readBounded(request, 16384)).toString("utf8"));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
      throw error;
    }
    return Response.json(
      await bindingCheckV2(
        bindingV2Ports(db),
        account.data,
        body,
        request.signal,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return bindingJsonError(error);
  }
}
