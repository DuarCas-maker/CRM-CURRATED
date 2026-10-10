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
        params.get("search") ||
        candidate.company_name ||
        candidate.name
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
      return Response.json(
        {
          cases,
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
        { accounts, runs },
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
