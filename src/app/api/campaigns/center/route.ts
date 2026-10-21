import { z } from "zod";
import { requireUser, HttpError, jsonError } from "@/lib/server/supabase";
import { campaignCsv, type CampaignContact } from "@/lib/campaign-center";

export async function GET(request: Request) {
  try {
    const { db, profile } = await requireUser();
    if (!["superadmin", "seller_admin", "seller"].includes(profile.role))
      throw new HttpError(403, "Seller access required");
    const params = new URL(request.url).searchParams;
    const mode = z
      .enum(["list", "details", "activity", "leads", "csv", "readiness"])
      .parse(params.get("mode") || "list");
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(params.get("page") || 0);
    const search = z
      .string()
      .max(200)
      .parse(params.get("search") || "");
    if (mode === "readiness") {
      const filter = z
        .enum([
          "all",
          "eligible",
          "sent",
          "reserved",
          "excluded",
          "preparing",
          "converted",
        ])
        .parse(params.get("filter") || "eligible");
      const result = await db.rpc("campaign_readiness_page", {
        search_text: search,
        state_filter: filter,
        page_number: page,
      });
      if (result.error) {
        if (["PGRST202", "42883"].includes(result.error.code))
          throw new HttpError(
            503,
            "Aplica 045_campaign_readiness.sql para consultar los contactos disponibles. / Apply 045_campaign_readiness.sql to view available contacts.",
          );
        if (/access|MFA/i.test(result.error.message))
          throw new HttpError(403, "Seller access required");
        throw new HttpError(400, result.error.message);
      }
      return Response.json(result.data, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const filter = z
      .enum(["all", "replied", "unanswered", "pending", "attention", "errors"])
      .parse(params.get("filter") || "all");
    async function rpc(name: string, args: Record<string, unknown>) {
      const { data, error } = await db.rpc(name, args);
      if (error) {
        if (["PGRST202", "42703", "42883"].includes(error.code))
          throw new HttpError(
            503,
            "Aplica la migración 043_campaign_first_contact.sql / Apply migration 043_campaign_first_contact.sql",
          );
        if (/access required|Seller access|MFA/i.test(error.message))
          throw new HttpError(403, error.message);
        throw new HttpError(400, error.message);
      }
      return data;
    }
    if (mode === "list")
      return Response.json(
        await rpc("campaign_center", {
          search_text: search,
          page_number: page,
          status_filter: z
            .enum([
              "all",
              "active",
              "scheduled",
              "draft",
              "paused",
              "completed",
            ])
            .parse(params.get("status") || "all"),
        }),
      );
    if (mode === "activity")
      return Response.json(
        await rpc("campaign_activity_page", { page_number: page }),
      );
    if (mode === "leads") {
      if (!["superadmin", "seller_admin"].includes(profile.role))
        throw new HttpError(403, "Campaign administrator required");
      return Response.json(
        await rpc("campaign_leads_page", {
          template: z.uuid().parse(params.get("template")),
          account: z.uuid().parse(params.get("account")),
          search_text: search,
          page_number: page,
        }),
      );
    }
    const id = z.uuid().parse(params.get("campaign"));
    const args = {
      campaign: id,
      search_text: search,
      state_filter: filter,
      page_number: page,
    };
    const contacts = await rpc("campaign_contacts_page", args);
    if (mode === "csv") {
      const locale = params.get("locale") === "en" ? "en" : "es";
      const header =
        locale === "es"
          ? [
              "Empresa",
              "Contacto",
              "Correo",
              "Estado del envío",
              "Respuesta recibida",
              "Última interacción",
              "Atención pendiente",
            ]
          : [
              "Company",
              "Contact",
              "Email",
              "Send status",
              "Reply received",
              "Last interaction",
              "Needs attention",
            ];
      const encoder = new TextEncoder();
      let current = contacts,
        index = page;
      const stream = new ReadableStream({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(campaignCsv([header]) + "\r\n"));
            while (!request.signal.aborted) {
              const rows: CampaignContact[] = current.rows;
              if (!rows.length) break;
              controller.enqueue(
                encoder.encode(
                  campaignCsv(
                    rows.map((c) => [
                      c.company,
                      c.name,
                      c.email,
                      c.send_status,
                      c.reply_at,
                      c.last_interaction,
                      c.needs_attention
                        ? locale === "es"
                          ? "Sí"
                          : "Yes"
                        : locale === "es"
                          ? "No"
                          : "No",
                    ]),
                  ).slice(1) + "\r\n",
                ),
              );
              if ((index + 1) * 50 >= current.total) break;
              current = await rpc("campaign_contacts_page", {
                ...args,
                page_number: ++index,
              });
            }
            controller.close();
          } catch (e) {
            controller.error(e);
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="curated-campaign-${id}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const [metrics, campaignResult] = await Promise.all([
      rpc("campaign_contact_summary", { campaign: id }),
      db.from("campaigns").select("*").eq("id", id).single(),
    ]);
    if (campaignResult.error || !campaignResult.data)
      throw new HttpError(404, "Campaign not found");
    return Response.json({
      ...contacts,
      metrics,
      campaign: campaignResult.data,
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid campaign parameters" },
        { status: 400 },
      );
    return jsonError(e);
  }
}
