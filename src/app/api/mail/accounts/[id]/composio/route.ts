import { z } from "zod";
import { requireUser, checkOrigin } from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { parseBindingQuery } from "@/lib/composio-bindings";
import { bindingV2Query } from "@/lib/composio-bindings-v2";
import {
  bindingPageV2,
  bindingCommandV2,
  bindingV2Ports,
} from "@/lib/server/mail-accounts/composio-binding-v2";
import {
  ComposioBindingError,
  requireComposioAdmin,
  bindingJsonError,
  composioBindingPage,
  composioBindingCommand,
} from "@/lib/server/mail-accounts/composio-binding";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { db, profile } = await requireUser();
    requireComposioAdmin(profile);
    const account = z.uuid().safeParse((await context.params).id);
    const params = new URL(request.url).searchParams;
    const v2 = params.has("contract_version");
    const query = v2 ? bindingV2Query(params) : parseBindingQuery(params);
    if (!account.success || !query)
      throw new ComposioBindingError("C_BINDING_INVALID_INPUT", 400);
    return Response.json(
      v2
        ? await bindingPageV2(
            bindingV2Ports(db),
            account.data,
            query.cursor,
            query.limit,
          )
        : await composioBindingPage(
            db,
            account.data,
            query.cursor,
            query.limit,
          ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return bindingJsonError(error);
  }
}
export async function POST(request: Request, context: Context) {
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
    const versioned =
      !!body && typeof body === "object" && "contract_version" in body;
    return Response.json(
      versioned
        ? await bindingCommandV2(bindingV2Ports(db), account.data, body)
        : await composioBindingCommand(db, account.data, body),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return bindingJsonError(error);
  }
}
