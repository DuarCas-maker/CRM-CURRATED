import { z } from "zod";
import {
  requireUser,
  serviceClient,
  checkOrigin,
  checkDb,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import {
  historyActionSchema,
  historyAction,
} from "@/lib/server/gmail-history-actions";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";

export async function GET(request: Request) {
  try {
    if (!gmailHistoryEnabled())
      throw new HttpError(
        503,
        "Aplica las migraciones de Gmail y activa GMAIL_HISTORY_ENABLED en web y trabajador. / Apply Gmail migrations and enable GMAIL_HISTORY_ENABLED on web and worker.",
      );
    const { db, profile } = await requireUser();
    if (profile.role !== "superadmin")
      throw new HttpError(403, "Superadmin required");
    const params = new URL(request.url).searchParams;
    if (params.get("candidate")) {
      const candidate = checkDb(
        await db
          .from("gmail_candidates")
          .select("*")
          .eq("id", z.uuid().parse(params.get("candidate")))
          .single(),
      )!;
      const service = serviceClient();
      const clean = (
        params.get("search") ??
        (candidate.company_name || candidate.name)
      )
        .replace(/[%,().\\]/g, " ")
        .slice(0, 100);
      const matches =
        checkDb(
          await service
            .from("opportunities")
            .select("id,company,contact_id,company_id,stage")
            .ilike("company", `%${clean}%`)
            .limit(30),
        ) || [];
      const exact = candidate.candidate_opportunity_ids.length
        ? checkDb(
            await service
              .from("opportunities")
              .select("id,company,contact_id,company_id,stage")
              .in("id", candidate.candidate_opportunity_ids),
          ) || []
        : [];
      const cases = [
        ...new Map([...exact, ...matches].map((c) => [c.id, c])).values(),
      ];
      if (clean) {
        const byContact =
          checkDb(
            await service
              .from("contacts")
              .select("id,company_id")
              .or(`email.ilike.%${clean}%,name.ilike.%${clean}%`)
              .limit(30),
          ) || [];
        if (byContact.length) {
          const byCase =
            checkDb(
              await service
                .from("opportunities")
                .select("id,company,contact_id,company_id,stage")
                .or(
                  `contact_id.in.(${byContact.map((c) => c.id).join(",")})${
                    byContact.some((c) => c.company_id)
                      ? `,company_id.in.(${byContact
                          .filter((c) => c.company_id)
                          .map((c) => c.company_id)
                          .join(",")})`
                      : ""
                  }`,
                )
                .limit(30),
            ) || [];
          for (const c of byCase)
            if (!cases.some((x) => x.id === c.id)) cases.push(c);
        }
      }
      const evidenceId = params.get("evidence");
      if (evidenceId) {
        z.uuid().parse(evidenceId);
        if (!candidate.evidence_ids.includes(evidenceId))
          throw new HttpError(403, "Choose this participant's evidence");
        const archive = checkDb(
          await service
            .from("gmail_archive_messages")
            .select("participants,subject")
            .eq("id", evidenceId)
            .single(),
        )!;
        const emails = (archive.participants as { email: string }[]).map(
          (p) => p.email,
        );
        const contacts = emails.length
          ? checkDb(
              await service
                .from("contacts")
                .select("id,company_id")
                .in("email", emails),
            ) || []
          : [];
        if (contacts.length) {
          const related =
            checkDb(
              await service
                .from("opportunities")
                .select("id,company,contact_id,company_id,stage")
                .or(
                  `contact_id.in.(${contacts.map((c) => c.id).join(",")})${
                    contacts.some((c) => c.company_id)
                      ? `,company_id.in.(${contacts
                          .filter((c) => c.company_id)
                          .map((c) => c.company_id)
                          .join(",")})`
                      : ""
                  }`,
                )
                .limit(30),
            ) || [];
          for (const c of related)
            if (!cases.some((x) => x.id === c.id)) cases.push(c);
        }
      }
      const threads =
        candidate.participant_kind === "team"
          ? checkDb(
              await db.rpc("gmail_team_threads", {
                candidate: candidate.id,
                cursor_offset:
                  Math.max(
                    0,
                    Math.floor(Number(params.get("thread_page")) || 0),
                  ) * 50,
              }),
            ) || []
          : [];
      const associatedIds = threads
        .map((th: { opportunity_id: string | null }) => th.opportunity_id)
        .filter(Boolean);
      if (associatedIds.length) {
        const related =
          checkDb(
            await service
              .from("opportunities")
              .select("id,company,contact_id,company_id,stage")
              .in("id", associatedIds),
          ) || [];
        for (const c of related)
          if (!cases.some((x) => x.id === c.id)) cases.push(c);
      }
      const clientContacts = cases.length
        ? checkDb(
            await service
              .from("contacts")
              .select("id,email,name")
              .in(
                "id",
                cases.map((c) => c.contact_id),
              ),
          ) || []
        : [];
      const cleanQuery = clean || "";
      const pending =
        checkDb(
          await service
            .from("gmail_candidates")
            .select("id,email,name,company_name,run_id")
            .is("imported_at", null)
            .in("participant_kind", ["client", "unknown"])
            .or(
              `company_name.ilike.%${cleanQuery}%,name.ilike.%${cleanQuery}%,email.ilike.%${cleanQuery}%`,
            )
            .limit(30),
        ) || [];
      const intents =
        checkDb(
          await db
            .from("gmail_pending_associations")
            .select("*")
            .eq("team_candidate_id", candidate.id),
        ) || [];
      const intentClients = intents.length
        ? checkDb(
            await service
              .from("gmail_candidates")
              .select("id,email,company_name,name")
              .in(
                "id",
                intents.map((p) => p.client_candidate_id),
              ),
          ) || []
        : [];
      return Response.json(
        {
          threads,
          pending_candidates: pending,
          pending_associations: intents.map((p) => ({
            ...p,
            company_name:
              intentClients.find((c) => c.id === p.client_candidate_id)
                ?.company_name ||
              intentClients.find((c) => c.id === p.client_candidate_id)?.name,
            email: intentClients.find((c) => c.id === p.client_candidate_id)
              ?.email,
          })),
          cases: cases.map((c) => ({
            ...c,
            email:
              clientContacts.find((ct) => ct.id === c.contact_id)?.email || "",
            contact:
              clientContacts.find((ct) => ct.id === c.contact_id)?.name || "",
          })),
          companies: checkDb(
            await service
              .from("companies")
              .select("id,name")
              .ilike("name", `%${clean}%`)
              .limit(30),
          ),
          processes: cases.length
            ? checkDb(
                await db
                  .from("financing_processes")
                  .select("*")
                  .in(
                    "opportunity_id",
                    cases.map((c) => c.id),
                  ),
              )
            : [],
          submissions: cases.length
            ? checkDb(
                await db
                  .from("submissions")
                  .select("id,opportunity_id,lender_id,process_id")
                  .in(
                    "opportunity_id",
                    cases.map((c) => c.id),
                  ),
              )
            : [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const runId = params.get("run");
    const accounts = checkDb(
      await db.from("mail_accounts").select("*").order("email"),
    );
    const team_members =
      checkDb(await db.from("gmail_team_members").select("*").order("email")) ||
      [];
    const batches = await Promise.all([
      db
        .from("gmail_runs")
        .select("*")
        .eq("purpose", "historical")
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("gmail_runs")
        .select("*")
        .eq("purpose", "continuous")
        .neq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(50),
      ...(runId
        ? [db.from("gmail_runs").select("*").eq("id", z.uuid().parse(runId))]
        : []),
    ]);
    const runs = [
      ...new Map(
        batches.flatMap((b) => checkDb(b) || []).map((r) => [r.id, r]),
      ).values(),
    ];
    if (!runId)
      return Response.json(
        { accounts, runs, team_members },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (!z.uuid().safeParse(runId).success)
      throw new HttpError(400, "Invalid run");
    const page = Math.max(
      0,
      Math.min(100000, Math.floor(Number(params.get("page")) || 0)),
    );
    const result = await db
      .from("gmail_candidates")
      .select("*", { count: "exact" })
      .eq("run_id", runId)
      .order("last_at", { ascending: false })
      .order("id")
      .range(page * 50, page * 50 + 49);
    return Response.json(
      {
        accounts,
        runs,
        team_members,
        candidates: checkDb(result),
        total: result.count,
        page,
        stats: checkDb(await db.rpc("gmail_preview_stats", { run: runId })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(request: Request) {
  try {
    if (!gmailHistoryEnabled())
      throw new HttpError(503, "Gmail history is not enabled");
    checkOrigin(request);
    const { profile } = await requireUser();
    const input = historyActionSchema.parse(
      JSON.parse((await readBounded(request, 30000)).toString("utf8")),
    );
    return Response.json(await historyAction(input, profile));
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Invalid fields" }, { status: 400 });
    return jsonError(e);
  }
}
