import { outgoingMailSchema } from "@/lib/mail-manager";
import { prepareLenderReview } from "@/lib/server/lender-preview";
import { senderSignature } from "@/lib/server/mail-manager";
import { mailAccess } from "@/lib/server/mail-access";
import { readBounded } from "@/lib/server/body";
import {
  checkDb,
  checkOrigin,
  HttpError,
  requireUser,
} from "@/lib/server/supabase";
import { deliveryJsonError } from "@/lib/server/brand-delivery";

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await requireUser();
    const input = outgoingMailSchema.parse(
      JSON.parse((await readBounded(request, 300000)).toString("utf8")),
    );
    if (input.mode !== "lenders")
      throw new HttpError(400, "Elige un envío a lenders.");
    if (
      !checkDb(await db.rpc("can_mail_case", { case_id: input.opportunity_id }))
    )
      throw new HttpError(403, "Case access required");
    await mailAccess(db, input.opportunity_id, true);
    const signature = await senderSignature(
      db,
      input.account_id,
      input.brand_preparation,
      input.opportunity_id,
    );
    return Response.json(await prepareLenderReview(db, input, signature), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const response = deliveryJsonError(
      e instanceof SyntaxError
        ? new HttpError(400, "JSON inválido. / Invalid JSON.")
        : e,
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
