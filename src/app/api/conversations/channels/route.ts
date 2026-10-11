import { z } from "zod";
import {
  requireUser,
  serviceClient,
  checkDb,
  jsonError,
} from "@/lib/server/supabase";
import { teamLabels } from "@/lib/server/gmail-team";
export async function GET(request: Request) {
  try {
    const id = z.uuid().parse(new URL(request.url).searchParams.get("case"));
    const { db } = await requireUser();
    const opportunity = checkDb(
      await db
        .from("opportunities")
        .select("id,company,contact_id,company_id")
        .eq("id", id)
        .single(),
    )!;
    const conversations =
      checkDb(
        await db
          .from("conversations")
          .select("*")
          .eq("opportunity_id", id)
          .order("updated_at", { ascending: false }),
      ) || [];
    const processes =
      checkDb(
        await db
          .from("financing_processes")
          .select("id,label,sequence_number")
          .eq("opportunity_id", id)
          .order("sequence_number", { ascending: false }),
      ) || [];
    const routes = conversations.length
      ? checkDb(
          await db
            .from("conversation_lenders")
            .select("*")
            .in(
              "conversation_id",
              conversations.map((c) => c.id),
            ),
        ) || []
      : [];
    const lenderIds = [...new Set(routes.map((r) => r.lender_id))];
    const lenders = lenderIds.length
      ? checkDb(
          await db.from("lenders").select("id,name,email").in("id", lenderIds),
        ) || []
      : [];
    const contacts = lenderIds.length
      ? checkDb(
          await db
            .from("lender_contacts")
            .select("email,lender_id")
            .in("lender_id", lenderIds),
        ) || []
      : [];
    const accounts =
      checkDb(await db.from("mail_accounts").select("email")) || [];
    // Return only team addresses actually present in the user's accessible messages.
    const latest = conversations.length
      ? checkDb(
          await db
            .from("messages")
            .select("sender,participants")
            .in(
              "conversation_id",
              conversations.map((c) => c.id),
            )
            .order("sent_at", { ascending: false })
            .limit(1000),
        ) || []
      : [];
    const teams = await teamLabels(
      latest.flatMap((m) => [
        m.sender,
        ...(m.participants || []).map((p: { email: string }) => p.email),
      ]),
    );
    const links = opportunity.company_id
      ? checkDb(
          await db
            .from("company_contacts")
            .select("contact_id")
            .eq("company_id", opportunity.company_id)
            .in("relationship", ["primary", "contact", "broker"]),
        ) || []
      : [];
    const clients =
      checkDb(
        await db
          .from("contacts")
          .select("email")
          .in("id", [
            opportunity.contact_id,
            ...links.map((l) => l.contact_id),
          ]),
      ) || [];
    return Response.json(
      {
        conversations,
        processes,
        routes,
        lenders,
        lender_contacts: contacts,
        team_emails: [
          ...new Set([...accounts.map((a) => a.email), ...teams.keys()]),
        ],
        client_emails: clients.map((c) => c.email),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
