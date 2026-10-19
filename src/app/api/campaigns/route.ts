import { z } from "zod";
import {
  requireUser,
  checkOrigin,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { campaignAudience, campaignDb } from "@/lib/server/campaign-delivery";
import { readBounded } from "@/lib/server/body";
import { renderCampaignContent } from "@/lib/campaign-content";
import { audienceValues } from "@/lib/campaign-delivery";
import { renderTemplate } from "@/lib/domain";

export async function GET(request: Request) {
  try {
    const { db, profile } = await requireUser();
    if (!["superadmin", "seller_admin"].includes(profile.role))
      throw new HttpError(403, "Campaign administrator required");
    const id = new URL(request.url).searchParams.get("campaign");
    const budgets = campaignDb(await db.rpc("campaign_sending_budgets"));
    return Response.json({
      budgets,
      ...(id
        ? { audience: await campaignAudience(db, z.uuid().parse(id)) }
        : {}),
    });
  } catch (e) {
    return jsonError(e);
  }
}

// Tests are addressed only to the signed-in team member, never to the lead.
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    if (!["superadmin", "seller_admin"].includes(profile.role))
      throw new HttpError(403, "Campaign administrator required");
    const p = z
      .object({
        campaign_id: z.uuid(),
        contact_id: z.uuid(),
        request_key: z.uuid(),
      })
      .parse(JSON.parse((await readBounded(request, 4096)).toString("utf8")));
    const contacts = await campaignAudience(db, p.campaign_id);
    const contact = contacts.find(
      (c) => c.contact_id === p.contact_id && c.reason === "eligible",
    );
    if (!contact)
      throw new HttpError(
        400,
        "Selecciona un cliente elegible con todos los datos de la plantilla.",
      );
    const campaign = campaignDb(
      await db.from("campaigns").select("*").eq("id", p.campaign_id).single(),
    );
    const values = audienceValues(contact);
    const message = renderCampaignContent(
      campaign.body,
      values,
      campaign.body_format,
    );
    const result = campaignDb(
      await db.rpc("queue_campaign_test", {
        campaign: p.campaign_id,
        contact: contact.contact_id,
        subject_text: `[PRUEBA] ${renderTemplate(campaign.subject, values)}`,
        body_text: message.text,
        html: message.html,
        request: p.request_key,
      }),
    );
    return Response.json({ id: result, recipient: profile.email });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Invalid fields" }, { status: 400 });
    return jsonError(e);
  }
}
