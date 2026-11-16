import { demoWorkspace } from "../../src/lib/demo";
import type {
  CaseProgressSource,
  ProgressEvent,
  ProgressProcess,
} from "../../src/lib/pipeline-os/case-progress";

export const progressNow = Date.parse("2026-11-15T15:00:00Z");
export function progressFixture(): CaseProgressSource {
  const data = demoWorkspace();
  const opportunity = {
    ...data.opportunities[0],
    id: "60000000-0000-4000-8000-000000000001",
    company: "Empresa ficticia",
    application_complete: true,
    application_signed: true,
    handed_off_at: "2026-11-14T12:00:00Z",
    funded_at: null,
    funded_amount: null,
    funded_lender_id: null,
  };
  const documents = ["application", ...Array(4).fill("bank_statement")].map(
    (kind: string, i) => ({
      id: `doc-${i}`,
      opportunity_id: opportunity.id,
      name: `Archivo ficticio ${i}`,
      kind,
      period: "2026-10",
      status: "approved" as const,
      source: "fixture",
      created_at: "2026-11-13T12:00:00Z",
      storage_path: `fictional/file-${i}.pdf`,
      content_hash: `fixture-hash-${i}`,
      required: true,
    }),
  );
  const process: ProgressProcess = {
    id: "process-1",
    opportunity_id: opportunity.id,
    sequence_number: 1,
    state: "submitted",
    classification: "active",
    is_unclassified_archive: false,
  };
  return {
    profile: data.profile,
    opportunity,
    documents,
    reports: [
      {
        id: "run-1",
        opportunity_id: opportunity.id,
        status: "approved",
        analysis_id: "analysis-1",
        reviewed_at: "2026-11-14T12:00:00Z",
      },
    ],
    lenders: [{ id: "lender-fictional", email: "lender@example.invalid" }],
    conversations: [
      {
        id: "conversation-1",
        opportunity_id: opportunity.id,
        process_id: process.id,
        submission_id: "submission-1",
        recipient_email: "lender@example.invalid",
      } as import("../../src/lib/domain").Conversation,
    ],
    messages: [
      {
        id: "message-1",
        conversation_id: "conversation-1",
        direction: "outbound",
        status: "sent",
        sent_at: "2026-11-14T13:00:00Z",
        participants: [{ role: "to", email: "lender@example.invalid" }],
      } as import("../../src/lib/domain").Message,
    ],
    analyses: [
      {
        id: "analysis-1",
        opportunity_id: opportunity.id,
        summary: "Resumen ficticio",
        conclusion: "Conclusión ficticia",
        observations: "",
        recommendations: "Recomendación ficticia",
        reviewer_id: data.profile.id,
        reviewed_at: "2026-11-14T12:00:00Z",
        is_current: true,
      },
    ],
    processes: [process],
    submissions: [
      {
        id: "submission-1",
        opportunity_id: opportunity.id,
        process_id: process.id,
        lender_id: "lender-fictional",
        closer_id: data.profile.id,
        status: "submitted",
        channel: "email",
        submitted_at: "2026-11-14T12:00:00Z",
        next_action: "",
        next_action_at: "",
        external_reference: "",
      },
    ],
    offers: [],
    events: [],
  };
}
export function progressOffer(
  source: CaseProgressSource,
  status = "received",
  expires_at = "2026-12-01T12:00:00Z",
) {
  return {
    id: "offer-1",
    opportunity_id: source.opportunity.id,
    submission_id: "submission-1",
    amount: 50000,
    status,
    expires_at,
    product: "MCA",
    term: "24 semanas",
    cost: "1.2",
    frequency: "semanal",
    fees: "0",
  };
}
export function progressEvent(
  source: CaseProgressSource,
  kind: string,
): ProgressEvent {
  return {
    id: `event-${kind}`,
    opportunity_id: source.opportunity.id,
    process_id: "process-1",
    kind,
    occurred_at: "2026-11-14T12:00:00Z",
    archive_message_id: "fictional-message",
    document_id: null,
  };
}
