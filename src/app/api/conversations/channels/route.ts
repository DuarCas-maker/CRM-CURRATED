import { z } from "zod";
import {
  requireUser,
  serviceClient,
  checkDb,
  jsonError,
} from "@/lib/server/supabase";
import { conversationSummary } from "@/lib/server/conversation-summary";
import type { MailChannels } from "@/lib/conversation-threads";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = z.uuid().parse(params.get("case"));
    const { db, profile } = await requireUser();
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
    const submissions =
      checkDb(
        await serviceClient()
          .from("submissions")
          .select("id,lender_id,process_id,status")
          .eq("opportunity_id", id),
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
    // Directory reads already allow authenticated CRM users. Recognize historical
    // senders even when this case's lender routes have not yet been indexed.
    const lenders: MailChannels["lenders"] = [];
    const contacts: MailChannels["lender_contacts"] = [];
    for (let page = 0; ; page++) {
      const rows =
        checkDb(
          await db
            .from("lenders")
            .select("id,name,email")
            .is("archived_at", null)
            .order("id")
            .range(page * 1000, page * 1000 + 999),
        ) || [];
      lenders.push(...rows);
      if (rows.length < 1000) break;
    }
    for (let page = 0; ; page++) {
      const rows =
        checkDb(
          await db
            .from("lender_contacts")
            .select("*")
            .order("email")
            .range(page * 1000, page * 1000 + 999),
        ) || [];
      contacts.push(
        ...rows.filter((r) => lenders.some((l) => l.id === r.lender_id)),
      );
      if (rows.length < 1000) break;
    }
    const accounts =
      checkDb(await db.from("mail_accounts").select("id,email,status")) || [];
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
    const channels: MailChannels = {
      conversations,
      processes,
      submissions,
      routes,
      lenders,
      lender_contacts: contacts,
      team_emails: [...new Set(accounts.map((a) => a.email))],
      client_emails: clients.map((c) => c.email.toLowerCase()),
    };
    const { summaries, headers, teamEmails } = await conversationSummary(
      db,
      id,
      channels,
      params.get("q") || "",
    );
    const [caseRow, required, approved, followup] = await Promise.all([
      db.from("opportunity_workspace").select("*").eq("id", id).single(),
      db
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("opportunity_id", id)
        .eq("required", true),
      db
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("opportunity_id", id)
        .eq("required", true)
        .eq("status", "approved"),
      db
        .from("tasks")
        .select("title,due_at")
        .eq("opportunity_id", id)
        .eq("status", "open")
        .order("due_at")
        .limit(1),
    ]);
    checkDb(required);
    checkDb(approved);
    const caseData = checkDb(caseRow)!;
    const task = (checkDb(followup) || [])[0];
    const customerMessages = headers
      .filter(
        (m) =>
          m.direction === "inbound" &&
          channels.client_emails.includes(m.sender.toLowerCase()),
      )
      .sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at));
    const permissions =
      checkDb(
        await db
          .from("mail_permissions")
          .select("account_id")
          .eq("user_id", profile.id)
          .eq("can_send", true),
      ) || [];
    return Response.json(
      {
        thread_summaries: summaries,
        sender_account_ids: accounts
          .filter(
            (a) =>
              a.status === "connected" &&
              (profile.role === "superadmin" ||
                permissions.some((p) => p.account_id === a.id)),
          )
          .map((a) => a.id),
        context: {
          opportunity: caseData,
          client_emails: channels.client_emails,
          last_client_message_at: customerMessages[0]?.sent_at || null,
          documents: {
            required: required.count || 0,
            approved: approved.count || 0,
            ready: !!required.count && required.count === approved.count,
          },
          followup: task
            ? { title: task.title, at: task.due_at }
            : caseData.next_action
              ? { title: caseData.next_action, at: caseData.next_action_at }
              : null,
        },
        conversations,
        processes,
        submissions,
        stats: checkDb(await db.rpc("mail_case_stats", { case_id: id })),
        routes,
        lenders,
        lender_contacts: contacts,
        team_emails: teamEmails,
        client_emails: clients.map((c) => c.email),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
