import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brandPreparationSchema } from "../brand-delivery";
import { HttpError } from "./supabase";
import { deliveryResult } from "./brand-delivery";
import { gmail } from "./google";
import { withMailboxScope } from "./mail-transport/mailbox-context";
import {
  mailRoutingActive,
  simpleAccountRuntime,
} from "./mail-transport/runtime-context";
const scopeSchema = z.object({
  account_id: z.uuid(),
  email: z.email(),
  actor_id: z.uuid(),
  brand_id: z.uuid(),
  brand_revision: z.number().int().positive(),
  account_revision: z.number().int().positive(),
  route_exists: z.boolean(),
  revision: z.number().int().min(0).safe(),
  provider: z.enum(["gmail_oauth", "composio"]),
  managed: z.boolean(),
});
export async function campaignSenderSignature(
  body: unknown,
  ctx: { db: SupabaseClient; profile: { role: string } },
) {
  if (!["superadmin", "seller_admin"].includes(ctx.profile.role))
    throw new HttpError(403, "Administrator required");
  const p = z
    .strictObject({
      account_id: z.uuid(),
      brand_preparation: brandPreparationSchema,
    })
    .parse(body);
  const read = async () =>
    scopeSchema.parse(
      deliveryResult(
        await ctx.db.rpc("campaign_signature_scope", {
          account: p.account_id,
          preparation: p.brand_preparation,
        }),
      ),
    );
  const captured = await read();
  if (captured.account_id !== p.account_id)
    throw new HttpError(409, "Sender context changed");
  const routing =
    mailRoutingActive() || !!(await simpleAccountRuntime(p.account_id));
  if (
    captured.provider !== "gmail_oauth" ||
    ((captured.route_exists || captured.managed) && !routing)
  )
    throw new HttpError(409, "Sender route is not available");
  const validate = async () => {
    try {
      return (
        JSON.stringify(await read()) === JSON.stringify(captured) &&
        (mailRoutingActive() ||
          !!(await simpleAccountRuntime(p.account_id))) === routing
      );
    } catch {
      return false;
    }
  };
  const result = await withMailboxScope(
    {
      account: p.account_id,
      revision: captured.revision,
      directOnly: true,
      validate,
    },
    () =>
      gmail<{ signature?: string; displayName?: string }>(
        p.account_id,
        `settings/sendAs/${encodeURIComponent(captured.email)}`,
        {},
        async () => {
          if (!(await validate()))
            throw new HttpError(409, "Sender context changed");
        },
      ),
  );
  if (
    (typeof result.signature !== "undefined" &&
      typeof result.signature !== "string") ||
    (typeof result.displayName !== "undefined" &&
      typeof result.displayName !== "string") ||
    (result.signature || "").length > 100000 ||
    /[\r\n]/.test(result.displayName || "")
  )
    throw new HttpError(502, "Invalid Gmail signature");
  return {
    html: result.signature || "",
    name: result.displayName || "",
    email: captured.email,
  };
}
