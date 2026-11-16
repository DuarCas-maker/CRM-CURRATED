import type { Workspace } from "../domain";
import type { PipelineProcess } from "./module";
import type { MasterSource } from "./master-pipeline";
/** Synthetic read-model enrichment only. Never called for a real workspace. */
export function masterDemoSource(
  data: Workspace,
  processes: PipelineProcess[],
  now = Date.now(),
): MasterSource {
  if (!data.demo) throw Error("MASTER_DEMO_ONLY");
  const at = (days: number) => new Date(now - days * 86400000).toISOString();
  const lead = data.leads.find((l) => !l.suppressed && !l.opportunity_id),
    account = data.accounts[0];
  const applications: MasterSource["events"] = data.opportunities.flatMap(
    (o, i) =>
      o.application_complete
        ? [
            {
              id: "demo-app-" + o.id,
              opportunity_id: o.id,
              process_id: null,
              submission_id: null,
              kind: "application_received",
              area: "seller",
              evidence_type: "manual",
              occurred_at: at(1 + (i % 12)),
            },
          ]
        : [],
  );
  const milestones: MasterSource["events"] = processes.map((p, i) => ({
    id: "demo-process-" + p.id,
    opportunity_id: p.opportunity_id,
    process_id: p.id,
    submission_id: null,
    kind: p.state,
    area: "closer",
    evidence_type: "manual",
    occurred_at: at(1 + i),
  }));
  return {
    ...data,
    offers: data.offers.map((o, i) => ({ ...o, created_at: at(1 + (i % 6)) })),
    processes,
    archive:
      lead && account
        ? [
            {
              id: "demo-lead-reply",
              account_id: account.id,
              gmail_thread_id: "demo-lead-thread",
              subject: "Respuesta ficticia: quiero conocer los requisitos",
              sent_at: at(1),
              direction: "inbound",
              nature: "personal",
              reply_intent: "positive",
              participants: [{ email: lead.email, role: "from" }],
            },
          ]
        : [],
    accountOwners: lead && account ? { [account.id]: lead.seller_id } : {},
    leadCoverage: true,
    offerEvidence: data.offers.flatMap((o) => {
      const c = data.conversations.find(
          (c) => c.submission_id === o.submission_id,
        ),
        m = data.messages.find(
          (m) => m.conversation_id === c?.id && m.direction === "inbound",
        );
      return m ? [{ offer_id: o.id, message_id: m.id }] : [];
    }),
    events: [...applications, ...milestones],
  };
}
