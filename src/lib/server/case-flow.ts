import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Opportunity,
  Profile,
  Offer,
  Submission,
  Document,
} from "../domain";
import { canSeeOpportunity, canManageCaseFlow } from "../domain";
import {
  caseFlowCommandSchema,
  type FlowEvent,
  type FlowSnapshot,
} from "../pipeline-os/case-flow";
import { readPipelinePages } from "./pipeline-os-module";
import {
  requireUser,
  checkOrigin,
  checkDb,
  HttpError,
  jsonError,
} from "./supabase";
import { readBounded } from "./body";

export async function readCaseFlowRows<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  caseId: string,
  key = "opportunity_id",
) {
  return readPipelinePages<T>(async (offset) => {
    const result = await db
      .from(table)
      .select(columns, { count: "exact" })
      .eq(key, caseId)
      .order("id")
      .range(offset, offset + 499);
    if (
      result.error &&
      ["42703", "PGRST204", "PGRST205", "PGRST202", "42P01"].includes(
        result.error.code,
      )
    )
      throw new HttpError(
        503,
        "El flujo requiere la actualización del esquema. / Case flow schema update required.",
      );
    return {
      rows: (checkDb(result, `case_flow.${table}`) || []) as T[],
      total: result.count,
    };
  });
}
export async function readCaseFlowSnapshot(
  db: SupabaseClient,
  profile: Profile,
  caseId: string,
  requestedProcess?: string,
): Promise<FlowSnapshot> {
  const opportunity = checkDb(
    await db
      .from("opportunity_workspace")
      .select("id,seller_id,closer_id,handed_off_at")
      .eq("id", caseId)
      .is("archived_at", null)
      .maybeSingle(),
    "case_flow.case",
  ) as Opportunity | null;
  if (!opportunity || !canSeeOpportunity(profile, opportunity))
    throw new HttpError(404, "Expediente no disponible / Case unavailable");
  const canManage = canManageCaseFlow(profile, opportunity);
  const [processes, submissions, offers, events, documents, catalog] =
    await Promise.all([
      canManage
        ? readCaseFlowRows<FlowSnapshot["processes"][number]>(
            db,
            "financing_processes",
            "id,sequence_number,state,classification,is_unclassified_archive",
            caseId,
          )
        : [],
      canManage
        ? readCaseFlowRows<Submission>(
            db,
            "submissions",
            "id,lender_id,process_id,status,requirements_state,agreed_amount",
            caseId,
          )
        : [],
      canManage
        ? readCaseFlowRows<Offer>(
            db,
            "offers",
            "id,submission_id,amount,status,expires_at",
            caseId,
          )
        : [],
      readCaseFlowRows<FlowEvent>(
        db,
        "case_events",
        "id,opportunity_id,process_id,kind,body,occurred_at,created_at,archive_message_id,document_id,workflow_value",
        caseId,
      ),
      readCaseFlowRows<Document>(
        db,
        "documents",
        "id,name,storage_path",
        caseId,
      ),
      canManage
        ? readPipelinePages<{ id: string; name: string }>(async (offset) => {
            const result = await db
              .from("lenders")
              .select("id,name", { count: "exact" })
              .is("archived_at", null)
              .order("id")
              .range(offset, offset + 499);
            return {
              rows: checkDb(result, "case_flow.lenders") || [],
              total: result.count,
            };
          })
        : [],
    ]);
  const current = requestedProcess
    ? processes.find(
        (p) => p.id === requestedProcess && !p.is_unclassified_archive,
      )
    : processes
        .filter(
          (p) => p.classification === "active" && !p.is_unclassified_archive,
        )
        .sort((a, b) => b.sequence_number - a.sequence_number)[0];
  if (requestedProcess && !current)
    throw new HttpError(404, "Operación no disponible / Operation unavailable");
  const scoped = submissions.filter((s) => s.process_id === current?.id);
  return {
    caseId,
    processId: current?.id || null,
    canManage,
    processes: processes.filter((p) => !p.is_unclassified_archive),
    lenders: catalog.map((l) => {
      const validStatuses = [
        "received",
        "selected",
        "accepted",
        "approved",
        "active",
        "offered",
      ];
      const priority = (s: Submission) =>
        offers.some(
          (f) =>
            f.submission_id === s.id &&
            ["selected", "accepted"].includes(f.status),
        )
          ? 2
          : offers.some(
                (f) =>
                  f.submission_id === s.id && validStatuses.includes(f.status),
              )
            ? 1
            : 0;
      const sub = scoped
        .filter((s) => s.lender_id === l.id)
        .sort(
          (a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id),
        )[0];
      const ownOffers = offers.filter(
        (f) =>
          f.submission_id === sub?.id &&
          [
            "received",
            "selected",
            "accepted",
            "approved",
            "active",
            "offered",
          ].includes(f.status),
      );
      const selected = ownOffers.find((f) =>
        ["selected", "accepted"].includes(f.status),
      );
      return {
        ...l,
        submission_id: sub?.id || null,
        process_id: sub?.process_id || null,
        offered_amount: selected?.amount ?? ownOffers[0]?.amount ?? null,
        selected: !!selected,
        requirements_state:
          sub?.requirements_state === "pending" ||
          sub?.status === "requirements"
            ? "pending"
            : sub?.requirements_state || "not_requested",
        agreed_amount: sub?.agreed_amount ?? null,
      };
    }),
    events: canManage ? events : [],
    evidence: [
      ...new Map(
        events
          .filter((e) => !!e.archive_message_id)
          .map((e) => [
            e.archive_message_id!,
            {
              id: e.archive_message_id!,
              type: "mail" as const,
              label: `${e.occurred_at.slice(0, 10)} · ${(e.body || "Correo del expediente").slice(0, 160)}`,
            },
          ]),
      ).values(),
      ...documents
        .filter((d) => d.storage_path)
        .map((d) => ({ id: d.id, type: "document" as const, label: d.name })),
    ],
  };
}

export function createCaseFlowHandlers(
  dependencies: {
    user(): Promise<{ db: SupabaseClient; profile: Profile }>;
    origin(request: Request): void;
  } = { user: requireUser, origin: checkOrigin },
) {
  const respond = async (work: () => Promise<unknown>) => {
    let response: Response;
    try {
      response = Response.json(await work());
    } catch (error) {
      response =
        error instanceof z.ZodError || error instanceof SyntaxError
          ? Response.json(
              {
                error:
                  "Revisa los campos, el motivo y la evidencia. / Check fields, reason and evidence.",
              },
              { status: 400 },
            )
          : jsonError(error);
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  return {
    GET: (request: Request) =>
      respond(async () => {
        const query = new URL(request.url).searchParams,
          caseId = z.uuid().parse(query.get("case"));
        const process = query.get("process");
        if (process) z.uuid().parse(process);
        const { db, profile } = await dependencies.user();
        return readCaseFlowSnapshot(db, profile, caseId, process || undefined);
      }),
    POST: (request: Request) =>
      respond(async () => {
        dependencies.origin(request);
        const { db } = await dependencies.user();
        const body = z
          .object({ case_id: z.uuid(), command: caseFlowCommandSchema })
          .strict()
          .parse(
            JSON.parse((await readBounded(request, 16000)).toString("utf8")),
          );
        const result = await db.rpc("case_flow_command", {
          case_id: body.case_id,
          p: body.command,
        });
        if (result.error) {
          if (["PGRST202", "42883", "42703"].includes(result.error.code))
            throw new HttpError(
              503,
              "El flujo requiere la actualización del esquema. / Case flow schema update required.",
            );
          const message = result.error.message;
          const known =
            /^(Case flow access denied|Request key|Report unavailable|Reason required|Evidence belongs|Case evidence|Process unavailable|Lender unavailable|Closed process|Conversation belongs|Flow changed|Invalid credit amount|Offered amount|Available offer|Selected lender|Actual funding|Structured evidence|Documents changed|Analysis draft|Case is inaccessible)/.test(
              message,
            );
          if (message.startsWith("Flow changed"))
            throw new HttpError(
              409,
              "El expediente cambió. Actualiza el estado y revisa tu edición. / Case changed. Refresh and review your edit.",
            );
          if (message.startsWith("Contract already recorded"))
            throw new HttpError(
              409,
              "Ya existe un contrato en esta operación. Revisa el cierre antes de cambiar el lender. / A contract is already recorded. Review closing before changing lender.",
            );
          throw new HttpError(
            /access denied|read-only/.test(message) ? 403 : 409,
            known
              ? message
              : "No se pudo guardar el cambio; actualiza y revisa la evidencia. / Could not save; refresh and review evidence.",
          );
        }
        return result.data;
      }),
  };
}
