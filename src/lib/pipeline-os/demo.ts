import { demoWorkspace } from "../demo";
import type { PipelineProcess } from "./module";

// New-module fixtures only. They never change the CRM demo or any live case.
export function pipelineModuleDemo() {
  const data = demoWorkspace();
  const candidates = data.opportunities.filter(
    (o) => o.handed_off_at && !["funded", "lost", "paused"].includes(o.stage),
  );
  const processes: PipelineProcess[] = candidates.slice(0, 2).map((o, i) => ({
    id: `pos-demo-process-${i}`,
    opportunity_id: o.id,
    sequence_number: 1,
    state: i ? "contract_signed" : "contract_sent",
    classification: "active",
    is_unclassified_archive: false,
  }));
  for (const process of processes)
    for (const submission of data.submissions)
      if (submission.opportunity_id === process.opportunity_id)
        submission.process_id = process.id;
  const seed = candidates[0] || data.opportunities[0];
  const offerCase = {
    ...seed,
    id: "pos-demo-offers",
    contact_id: "pos-demo-contact",
    company: "Harbor Demo Market",
    contact: "Taylor Demo",
    email: "taylor@harbor.example",
    industry: "Retail",
    product: "MCA",
    stage: "offers" as const,
    amount: 60000,
    next_action: "Comparar plazo, costo y requisitos con el cliente",
    next_action_at: new Date(Date.now() + 86400000).toISOString(),
    funded_at: null,
    funded_amount: null,
  };
  data.opportunities.push(offerCase);
  const demoLenders = [
    {
      id: "pos-demo-lender-a",
      name: "Lender Demo A",
      email: "submissions@lender-a.example",
      channel: "email",
      products: ["MCA"],
      notes: "Datos ficticios; no usar para envíos reales.",
    },
    {
      id: "pos-demo-lender-b",
      name: "Lender Demo B",
      email: "submissions@lender-b.example",
      channel: "email",
      products: ["MCA"],
      notes: "Datos ficticios; no usar para envíos reales.",
    },
  ];
  data.lenders.push(...demoLenders);
  for (const [i, amount] of [55000, 75000].entries()) {
    const id = `pos-demo-offer-${i}`;
    data.submissions.push({
      id,
      opportunity_id: offerCase.id,
      lender_id: demoLenders[i].id,
      closer_id: offerCase.closer_id || data.profile.id,
      status: "offer",
      channel: "email",
      submitted_at: new Date().toISOString(),
      next_action: i ? "Confirmar antigüedad e ingresos" : "Revisar AR aging",
      next_action_at: new Date(Date.now() + 86400000).toISOString(),
      external_reference: "Demo",
    });
    data.offers.push({
      id,
      opportunity_id: offerCase.id,
      submission_id: id,
      product: "MCA",
      amount,
      term: i ? "20 weeks" : "28 weeks",
      cost: i ? "1.35 factor" : "1.25 factor",
      frequency: "weekly",
      fees: "Confirmar con lender",
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      status: i ? "received" : "accepted",
    });
    const target = demoLenders[i];
    const conversationId = `pos-demo-thread-${i}`;
    const at = new Date().toISOString();
    data.conversations.push({
      id: conversationId,
      opportunity_id: offerCase.id,
      submission_id: id,
      recipient_email: target.email,
      account_id: data.accounts[0].id,
      subject: `Demo submission · ${offerCase.company}`,
      area: "closer",
      needs_attention: true,
      updated_at: at,
    });
    data.messages.push({
      id: `pos-demo-mail-${i}`,
      conversation_id: conversationId,
      direction: "inbound",
      sender: target.email,
      body: `Demonstration only. Offer for Harbor Demo Market: $${amount}. Please review the requirements before proceeding.`,
      sent_at: at,
      status: "received",
      area: "closer",
      participants: [
        { email: target.email, role: "from" },
        { email: data.accounts[0].email, role: "to" },
      ],
    });
  }
  return { data, processes };
}
