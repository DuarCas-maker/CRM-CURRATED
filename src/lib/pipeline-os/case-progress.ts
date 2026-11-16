import type {
  Analysis,
  Document,
  Offer,
  Opportunity,
  Profile,
  Submission,
} from "../domain";
import { canSeeArea, canSeeOpportunity } from "../domain";
import {
  canManageCaseFlow,
  approvedReportIds,
  confirmedLenderSends,
  latestConfirmation,
  type FlowReport,
  type FlowValue,
} from "./case-flow";
import { documentProgress } from "../document-labels";
import { underwritingReadiness } from "../underwriting-status";
import type { PipelineProcess } from "./module";

export type ProgressText = [string, string];
export type CaseProgressAction =
  "documents" | "analysis" | "lenders" | "mail_history" | "conversations";
export type ProgressState = "complete" | "pending" | "unknown" | "restricted";
export interface ProgressItem {
  origin?: "automatic" | "manual";
  confirmationId?: string;
  id: string;
  title: ProgressText;
  detail: ProgressText;
  state: ProgressState;
  action: CaseProgressAction | null;
}
export interface ProgressPhase {
  id: "documents" | "risk" | "lenders" | "offers" | "closing";
  title: ProgressText;
  state: ProgressState;
  items: ProgressItem[];
}
export type ProgressProcess = PipelineProcess & {
  started_at?: string;
  actual_funded_amount?: number | null;
  funded_lender_id?: string | null;
};
export interface ProgressEvent {
  created_at?: string;
  workflow_value?: FlowValue | null;
  body?: string;
  id: string;
  opportunity_id: string;
  process_id: string | null;
  kind: string;
  occurred_at: string;
  archive_message_id: string | null;
  document_id: string | null;
}
export interface CaseProgressSource {
  reports?: FlowReport[];
  conversations?: import("../domain").Conversation[];
  messages?: import("../domain").Message[];
  lenders?: { id: string; email: string }[];
  lender_contacts?: { lender_id: string; email: string }[];
  profile: Profile;
  opportunity: Opportunity;
  documents: Document[];
  analyses: Analysis[];
  processes: ProgressProcess[];
  submissions: Submission[];
  offers: Offer[];
  events: ProgressEvent[];
  demo?: boolean;
}
export interface CaseProgress {
  canManage?: boolean;
  caseId: string;
  processNumber: number | null;
  multipleActive: boolean;
  closerVisible: boolean;
  outcome: "open" | "funded" | "without_funding";
  phases: ProgressPhase[];
}

/** Read-only evidence projection. A missing record never advances a persisted stage. */
export function buildCaseProgress(
  source: CaseProgressSource,
  now = Date.now(),
): CaseProgress {
  const { opportunity: o, profile } = source;
  if (!canSeeOpportunity(profile, o)) throw new Error("Case access denied");
  const closer = canSeeArea(profile, o, "closer");
  const docs = source.documents.filter(
    (d) => d.opportunity_id === o.id && d.kind !== "analysis_report",
  );
  const doc = documentProgress(docs);
  const ready = underwritingReadiness(docs, !!source.demo);
  const reviewed =
    approvedReportIds(
      (source.reports || []).filter((r) => r.opportunity_id === o.id),
      source.analyses,
    ).size > 0;
  const obsolete = (source.reports || []).some(
    (r) =>
      r.opportunity_id === o.id &&
      (r.status === "outdated" ||
        (r.status === "approved" &&
          source.analyses.some(
            (a) => a.id === r.analysis_id && a.is_current === false,
          ))),
  );
  const active = closer
    ? source.processes
        .filter(
          (p) =>
            p.opportunity_id === o.id &&
            p.classification === "active" &&
            !p.is_unclassified_archive,
        )
        .sort(
          (a, b) =>
            b.sequence_number - a.sequence_number || a.id.localeCompare(b.id),
        )
    : [];
  const process = active[0];
  const submissions = process
    ? source.submissions.filter(
        (s) => s.opportunity_id === o.id && s.process_id === process.id,
      )
    : [];
  const submissionIds = new Set(submissions.map((s) => s.id));
  const offers = source.offers.filter(
    (f) => f.opportunity_id === o.id && submissionIds.has(f.submission_id),
  );
  const events = process
    ? source.events.filter(
        (e) =>
          e.opportunity_id === o.id &&
          e.process_id === process.id &&
          (e.archive_message_id || e.document_id) &&
          Number.isFinite(Date.parse(e.occurred_at)) &&
          Date.parse(e.occurred_at) <= now,
      )
    : [];
  const has = (...states: string[]) =>
    !!process &&
    (states.includes(process.state) ||
      events.some((e) => states.includes(e.kind)));
  const contractSent = has(
    "contract_out",
    "contract_sent",
    "contract_signed",
    "final_approval",
    "disbursed",
  );
  const contractSigned = has("contract_signed", "final_approval", "disbursed");
  const finalApproval = has("final_approval", "disbursed");
  const funded =
    process?.state === "disbursed" &&
    Number.isFinite(process.actual_funded_amount) &&
    Number(process?.actual_funded_amount) > 0 &&
    !!process?.funded_lender_id;
  const terminal = ["client_withdrew", "funding_declined"].includes(
    process?.state || "",
  );
  const validOffer = (f: Offer) =>
    Number.isFinite(f.amount) &&
    f.amount > 0 &&
    [
      "received",
      "approved",
      "accepted",
      "selected",
      "offered",
      "active",
    ].includes(f.status.toLowerCase());
  const selected = offers.filter(
    (f) =>
      validOffer(f) &&
      ["accepted", "selected"].includes(f.status.toLowerCase()) &&
      (contractSent || !f.expires_at || Date.parse(f.expires_at) > now),
  );
  const available = offers.filter(
    (f) => validOffer(f) && (!f.expires_at || Date.parse(f.expires_at) > now),
  );
  const selection = selected.length === 1;
  const chosenSubmissions = new Set(selected.map((f) => f.submission_id));
  const requirements = submissions.filter(
    (s) =>
      (s.requirements_state === "pending" || s.status === "requirements") &&
      (!chosenSubmissions.size || chosenSubmissions.has(s.id)),
  ).length;
  const requirementsOpen =
    process?.state === "requirements" || requirements > 0;
  const sent = new Set(
    confirmedLenderSends(
      {
        opportunity: o,
        process,
        reports: source.reports || [],
        analyses: source.analyses,
        conversations: source.conversations || [],
        messages: source.messages || [],
        submissions: source.submissions,
        lenders: source.lenders || [],
        lender_contacts: source.lender_contacts,
        events: source.events,
      },
      now,
    ).map((m) => m.message_id),
  ).size;
  const sendDecision = latestConfirmation(
    source.events,
    o.id,
    "submissions",
    process?.id || null,
  )?.workflow_value?.decision;
  const manualSent = sendDecision === "confirmed";
  const finalAmount = submissions.find((s) =>
    chosenSubmissions.has(s.id),
  )?.agreed_amount;

  const item = (
    id: string,
    title: ProgressText,
    done: boolean,
    detail: ProgressText,
    action: CaseProgressAction,
  ): ProgressItem => ({
    id,
    title,
    detail,
    state: done ? "complete" : "pending",
    action,
  });
  const phase = (
    id: ProgressPhase["id"],
    title: ProgressText,
    items: ProgressItem[],
  ): ProgressPhase => ({
    id,
    title,
    items,
    state: items.every((i) => i.state === "complete") ? "complete" : "pending",
  });
  const lenderAction: CaseProgressAction = "conversations";
  const processItems = (items: ProgressItem[]) =>
    items.map((i) =>
      !closer
        ? {
            ...i,
            state: "restricted" as const,
            detail: [
              "Visible para el equipo de closers.",
              "Visible to the closer team.",
            ] as ProgressText,
            action: null,
          }
        : i,
    );
  const phases = [
    phase(
      "documents",
      ["Documentos", "Documents"],
      [
        item(
          "application",
          ["Aplicación completa y firmada", "Complete, signed application"],
          o.application_complete && o.application_signed,
          [
            o.application_complete && o.application_signed
              ? "Datos y firma de la solicitud confirmados."
              : "Confirma los datos y la firma de la solicitud.",
            o.application_complete && o.application_signed
              ? "Application details and signature confirmed."
              : "Confirm the application details and signature.",
          ],
          "mail_history",
        ),
        item(
          "application-file",
          ["Archivo de aplicación aprobado", "Approved application file"],
          doc.applicationApproved,
          [
            doc.applicationApproved
              ? "Archivo aprobado en Documentos."
              : doc.applicationReceived
                ? "Aplicación recibida; revisa su aprobación."
                : "Falta incorporar el archivo de aplicación.",
            doc.applicationApproved
              ? "File approved in Documents."
              : doc.applicationReceived
                ? "Application received; check its approval."
                : "The application file has not been incorporated.",
          ],
          "documents",
        ),
        item(
          "statements",
          [
            "Cuatro extractos bancarios aprobados",
            "Four approved bank statements",
          ],
          doc.statements >= 4,
          [
            `${Math.min(4, doc.statements)} de 4 extractos distintos aprobados.`,
            `${Math.min(4, doc.statements)} of 4 distinct statements approved.`,
          ],
          "documents",
        ),
        item(
          "additional-documents",
          [
            "Todos los archivos requeridos aprobados",
            "All required files approved",
          ],
          doc.approved === doc.total,
          [
            `${doc.approved} de ${doc.total} archivos requeridos aprobados en total.`,
            `${doc.approved} of ${doc.total} required files approved overall.`,
          ],
          "documents",
        ),
      ],
    ),
    phase(
      "risk",
      ["Análisis de riesgo", "Risk analysis"],
      [
        item(
          "sources",
          ["Fuentes listas para análisis", "Sources ready for analysis"],
          ready.ready,
          [
            "Aplicación, cuatro extractos distintos y demás fuentes requeridas; hasta 24 archivos utilizables.",
            "Application, four distinct statements and other required sources; up to 24 usable files.",
          ],
          "documents",
        ),
        item(
          "review",
          ["Informe de IA aprobado", "Approved AI report"],
          reviewed,
          [
            reviewed
              ? "Revisión humana vigente registrada."
              : obsolete
                ? "El análisis anterior está desactualizado; revisa las fuentes."
                : "Aprueba uno o más informes de IA desde su tarjeta. Los pendientes o no aprobados no completan este punto.",
            reviewed
              ? "Current human review recorded."
              : obsolete
                ? "The previous analysis is outdated; review its sources."
                : "Approve one or more AI reports from their cards. Pending or rejected reports do not complete this item.",
          ],
          "analysis",
        ),
      ],
    ),
    phase(
      "lenders",
      ["Pendiente de lenders", "Awaiting lender submission"],
      processItems([
        item(
          "submissions",
          ["Correo enviado a un lender", "Email sent to a lender"],
          sent > 0,
          [
            `${sent} correos confirmados. Al confirmar el primero, continúa en Oferta y negociación. Cola o inciertos no cuentan.`,
            `${sent} confirmed emails. After the first, continue to Offer and negotiation. Queued or uncertain do not count.`,
          ],
          lenderAction,
        ),
      ]),
    ),
    phase(
      "offers",
      ["Oferta y negociación", "Offer and negotiation"],
      processItems([
        item(
          "negotiation-started",
          ["Gestión con lenders iniciada", "Lender engagement started"],
          (sendDecision !== "pending" && (sent > 0 || manualSent)) ||
            offers.length > 0,
          [
            "El correo confirmado inicia la negociación; la oferta puede llegar después.",
            "A confirmed email starts negotiation; the offer may arrive later.",
          ],
          lenderAction,
        ),
        item(
          "offer",
          ["Oferta disponible para negociar", "Offer available to negotiate"],
          available.length > 0 || (contractSent && selected.length === 1),
          [
            contractSent && selected.length === 1
              ? "Oferta seleccionada respaldada por el contrato del proceso."
              : `${available.length} ofertas vigentes de este proceso.`,
            contractSent && selected.length === 1
              ? "Selected offer supported by this process's contract."
              : `${available.length} current offers for this process.`,
          ],
          lenderAction,
        ),
        item(
          "selection",
          ["Oferta o lender seleccionado", "Selected offer or lender"],
          selection,
          [
            selection
              ? "Selección explícita registrada en este proceso."
              : selected.length > 1
                ? "Hay varias ofertas seleccionadas; revisa el conflicto."
                : "Requiere una selección explícita. El mayor monto no se elige automáticamente.",
            selection
              ? "Explicit selection recorded in this process."
              : selected.length > 1
                ? "Several offers are selected; review the conflict."
                : "Requires an explicit selection. The largest amount is not selected automatically.",
          ],
          lenderAction,
        ),
        item(
          "requirements",
          ["Requisitos del lender resueltos", "Lender requirements resolved"],
          !requirementsOpen,
          [
            requirementsOpen
              ? "Hay requisitos adicionales pendientes en este proceso."
              : "Sin requisitos adicionales pendientes registrados.",
            requirementsOpen
              ? "This process has additional pending requirements."
              : "No additional pending requirements recorded.",
          ],
          lenderAction,
        ),
        item(
          "agreed-amount",
          ["Monto final acordado registrado", "Final agreed amount recorded"],
          selection && Number.isFinite(finalAmount) && Number(finalAmount) > 0,
          [
            "Registra el monto acordado en el lender elegido. No es un desembolso.",
            "Record the agreed amount for the selected lender. This is not funding.",
          ],
          lenderAction,
        ),
      ]),
    ),
    phase(
      "closing",
      ["Cierre y desembolso", "Closing and funding"],
      processItems([
        item(
          "contract-sent",
          ["Contrato del lender enviado", "Lender contract sent"],
          contractSent,
          [
            "Estado o evento explícito del contrato de este proceso.",
            "Explicit contract state or event for this process.",
          ],
          "mail_history",
        ),
        item(
          "contract-signed",
          ["Contrato del lender firmado", "Lender contract signed"],
          contractSigned,
          [
            "La firma de la aplicación no equivale a la firma del contrato.",
            "An application signature is not a lender contract signature.",
          ],
          "mail_history",
        ),
        item(
          "final-approval",
          ["Aprobación final registrada", "Recorded final approval"],
          finalApproval,
          [
            "La oferta aprobada no equivale a la aprobación final del desembolso.",
            "An approved offer is not final funding approval.",
          ],
          "mail_history",
        ),
        item(
          "funding",
          ["Desembolso confirmado", "Confirmed funding"],
          funded,
          [
            "Registro de desembolso, monto positivo y lender del mismo proceso.",
            "Funding record, positive amount and lender for the same process.",
          ],
          "mail_history",
        ),
      ]),
    ),
  ];
  for (const p of phases) {
    for (const i of p.items) {
      const confirmation = latestConfirmation(
        source.events,
        o.id,
        i.id,
        process?.id || null,
      );
      i.origin = "automatic";
      if (confirmation && i.state !== "restricted") {
        i.confirmationId = confirmation.id;
        if (confirmation.workflow_value?.decision !== "automatic") {
          i.origin = "manual";
          i.state =
            confirmation.workflow_value?.decision === "confirmed"
              ? "complete"
              : "pending";
          i.detail = [
            "Revisión manual con evidencia: " + (confirmation.body || ""),
            "Manual review with evidence: " + (confirmation.body || ""),
          ];
        }
      }
    }
    p.state = p.items.every((i) => i.state === "complete")
      ? "complete"
      : "pending";
    if (p.items.every((i) => i.state === "restricted")) p.state = "restricted";
    else if (p.items.every((i) => i.state === "unknown")) p.state = "unknown";
  }
  return {
    canManage: canManageCaseFlow(profile, o),
    caseId: o.id,
    processNumber: process?.sequence_number ?? null,
    multipleActive: active.length > 1,
    closerVisible: closer,
    outcome: terminal ? "without_funding" : funded ? "funded" : "open",
    phases,
  };
}
