import { pipelineModuleDemo } from "../../src/lib/pipeline-os/demo";
import {
  buildPipelineBoard,
  pipelineStages,
} from "../../src/lib/pipeline-os/module";
import type { TaskOverviewSource } from "../../src/lib/pipeline-os/tasks-overview";

export const overviewNow = Date.parse("2026-11-18T18:00:00Z");
export function tasksOverviewFixture(count = 73): TaskOverviewSource {
  const { data } = pipelineModuleDemo();
  const admin = {
    id: "admin",
    name: "Alex QA",
    email: "admin@example.test",
    role: "superadmin" as const,
    active: true,
  };
  const profiles = [
    admin,
    {
      id: "santino",
      name: "Santino Ejemplo",
      email: "santino@example.test",
      role: "seller" as const,
      active: true,
    },
    {
      id: "samuel",
      name: "Samuel Ejemplo",
      email: "samuel@example.test",
      role: "seller" as const,
      active: true,
    },
    {
      id: "zero",
      name: "Responsable sin actividad",
      email: "zero@example.test",
      role: "seller" as const,
      active: true,
    },
  ];
  const leads = Array.from({ length: count }, (_, i) => ({
    id: `lead-${i}`,
    contact_id: `contact-${i}`,
    opportunity_id: `case-${i}`,
    company: `Negocio ${String(i).padStart(3, "0")}`,
    contact: `Contacto ficticio ${i}`,
    email: `lead${i}@example.test`,
    seller_id: i % 2 ? "samuel" : "santino",
  }));
  const seed = buildPipelineBoard(data).rows[0];
  const cases = leads.map((l, i) => ({
    ...seed,
    id: l.opportunity_id,
    company: l.company,
    contact: l.contact,
    email: l.email,
    ownerId: l.seller_id,
    ownerName: profiles.find((p) => p.id === l.seller_id)!.name,
    groups: ["files", "tasks", pipelineStages[i % 5]] as typeof seed.groups,
  }));
  const campaigns = [
    {
      id: "campaign-a",
      account_id: "account-a",
      seller_id: "santino",
      first_contact: true,
      selected_contact_ids: ["contact-0", "contact-2"],
    },
    {
      id: "campaign-b",
      account_id: "account-b",
      seller_id: "santino",
      first_contact: true,
      selected_contact_ids: ["contact-0"],
    },
    {
      id: "campaign-c",
      account_id: "account-c",
      seller_id: "samuel",
      first_contact: true,
      selected_contact_ids: ["contact-1", "contact-3"],
    },
  ];
  const fact = (
    index: number,
    campaignId: string,
    send_status: string,
    replied = false,
  ) => ({
    campaignId,
    contact_id: leads[index].contact_id,
    opportunity_id: leads[index].opportunity_id,
    company: leads[index].company,
    name: leads[index].contact,
    email: leads[index].email,
    send_status,
    sent_at: send_status === "sent" ? "2026-01-02T12:00:00Z" : null,
    reply_at: replied ? "2026-01-03T12:00:00Z" : null,
    last_interaction: null,
    needs_attention: replied,
    conversation_id: `conversation-${index}`,
  });
  return {
    profile: admin,
    profiles,
    leads,
    cases,
    campaigns,
    accounts: [
      {
        id: "account-a",
        email: "santino@team-one.example.test",
        owner_id: "santino",
      },
      {
        id: "account-b",
        email: "santino@team-two.example.test",
        owner_id: "santino",
      },
      { id: "account-c", email: "samuel@example.test", owner_id: "samuel" },
      { id: "account-zero", email: "zero@example.test", owner_id: "zero" },
    ],
    facts: [
      fact(0, "campaign-a", "sent", true),
      fact(0, "campaign-a", "sent", true),
      fact(0, "campaign-b", "sent", true),
      fact(1, "campaign-c", "sent"),
      fact(2, "campaign-a", "queued"),
      fact(3, "campaign-c", "uncertain"),
    ],
    conversations: [1, 4].map((i) => ({
      id: `conversation-${i}`,
      opportunity_id: `case-${i}`,
      account_id: i === 1 ? "account-c" : "account-a",
      area: "seller" as const,
      submission_id: null,
      recipient_email: `lead${i}@example.test`,
    })),
    messages: [
      {
        id: "direct-send",
        conversation_id: "conversation-4",
        direction: "outbound",
        sender: "santino@team-one.example.test",
        status: "sent",
        sent_at: "2026-01-01T12:00:00Z",
        nature: "personal",
      },
      {
        id: "negative-reply",
        conversation_id: "conversation-1",
        direction: "inbound",
        sender: "Contacto <lead1@example.test>",
        status: "received",
        sent_at: "2026-01-03T12:00:00Z",
        nature: "personal",
        reply_intent: "negative",
      },
    ],
  };
}
