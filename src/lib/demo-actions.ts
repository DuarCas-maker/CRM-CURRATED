import type {
  Workspace,
  Profile,
  Opportunity,
  Stage,
  Task,
  Campaign,
} from "./domain";
import {
  canSeeOpportunity,
  canSeeArea,
  handoffErrors,
  normalizeEmail,
  validEmail,
  stages,
  renderTemplate,
} from "./domain";
import { normalizeRow, type Mapping } from "./imports";
import { defaultOperationalSettings } from "./operations";
import {
  planLenderImport,
  lenderImportRowSchema,
  lenderGuidelinesSchema,
  type LenderImportRow,
} from "./lender-management";
import {
  campaignPreviewValues,
  requiresApplication,
  type CampaignAsset,
  type EmailTemplate,
} from "./campaign-templates";
export function demoAction(
  current: Workspace,
  user: Profile,
  kind: string,
  p: Record<string, unknown>,
): Workspace {
  const d = structuredClone(current);
  const id = () => crypto.randomUUID();
  const now = new Date().toISOString();
  const text = (key: string) => String(p[key] || "").trim();
  const o = d.opportunities.find((o) => o.id === p.opportunity_id);
  const admin = ["superadmin", "seller_admin"].includes(user.role);
  const closer = ["superadmin", "closer_admin", "closer"].includes(user.role);
  if (o && !canSeeOpportunity(user, o)) throw new Error("Access denied");
  if (o?.handed_off_at && !closer)
    throw new Error(
      "El expediente transferido es de solo lectura / This case is read-only",
    );
  const activity = (body: string, type = kind) => {
    if (o)
      d.activities.unshift({
        id: id(),
        opportunity_id: o.id,
        actor_id: user.id,
        body,
        type,
        area: o.handed_off_at ? "closer" : "seller",
        created_at: now,
      });
  };
  const required = (...keys: string[]) => {
    if (keys.some((key) => !text(key)))
      throw new Error(
        "Completa los campos requeridos / Complete required fields",
      );
  };
  switch (kind) {
    case "operational_settings": {
      if (user.role !== "superadmin") throw new Error("Access denied");
      const settings = {
        ...defaultOperationalSettings,
        ...p,
        version: (d.operational?.settings.version || 1) + 1,
      };
      for (const key of [
        "reply_hours",
        "followup_hours",
        "offer_warning_hours",
      ] as const)
        if (
          !Number.isInteger(settings[key]) ||
          settings[key] < 1 ||
          settings[key] > (key === "followup_hours" ? 2160 : 720)
        )
          throw new Error("Plazo inválido");
      d.operational = { rows: [], total: 0, counts: {}, settings };
      break;
    }
    case "lender_guidelines": {
      if (!["superadmin", "closer_admin"].includes(user.role))
        throw new Error("Access denied");
      const lender = d.lenders.find((l) => l.id === p.lender_id);
      if (!lender) throw new Error("Lender missing");
      lender.guidelines = lenderGuidelinesSchema.parse(p.g);
      lender.guideline_version = (lender.guideline_version || 0) + 1;
      break;
    }
    case "import_lenders": {
      if (!["superadmin", "closer_admin"].includes(user.role))
        throw new Error("Access denied");
      const rows = (p.rows as LenderImportRow[]).map((r) =>
        lenderImportRowSchema.parse(r),
      );
      const plan = planLenderImport(rows, d.lenders, d.lender_contacts || []);
      if (plan.errors.length) throw new Error(plan.errors[0].message);
      d.lender_contacts ||= [];
      for (const row of rows) {
        let lender = d.lenders.find(
          (l) => l.name.toLowerCase() === row.company.toLowerCase(),
        );
        if (!lender) {
          lender = {
            id: id(),
            name: row.company,
            email: row.email,
            channel: row.channel,
            products: row.products
              .split(/[,;]/)
              .map((p) => p.trim())
              .filter(Boolean),
            notes: row.notes,
          };
          d.lenders.push(lender);
        }
        if (row.email && !d.lender_contacts.some((c) => c.email === row.email))
          d.lender_contacts.push({
            email: row.email,
            lender_id: lender.id,
            name: row.contact,
          });
      }
      break;
    }
    case "campaign_asset": {
      if (!admin) throw new Error("Access denied");
      d.campaign_assets = [
        p.asset as CampaignAsset,
        ...(d.campaign_assets || []),
      ];
      break;
    }
    case "campaign_template": {
      if (!admin) throw new Error("Access denied");
      const existing = d.email_templates?.find((t) => t.id === p.id);
      const template = {
        ...p,
        version: (existing?.version || 0) + 1,
        updated_at: now,
        archived_at: null,
      } as unknown as EmailTemplate;
      d.email_templates = [
        template,
        ...(d.email_templates || []).filter((t) => t.id !== template.id),
      ];
      break;
    }
    case "create_lead":
    case "create_opportunity": {
      required(
        "company",
        "contact",
        "email",
        "seller_id",
        "next_action",
        "next_action_at",
      );
      if (!["superadmin", "seller_admin", "seller"].includes(user.role))
        throw new Error("Access denied");
      const email = normalizeEmail(text("email"));
      if (!validEmail(email)) throw new Error("Invalid email");
      const existing =
        d.leads.find((l) => l.email === email) ||
        d.opportunities.find((o) => o.email === email);
      if (kind === "create_opportunity" && existing?.verification !== "valid")
        throw new Error("Verifica el lead primero / Verify the lead first");
      if (kind === "create_lead" && existing) break;
      const created: Opportunity = {
        id: id(),
        contact_id: existing?.contact_id || id(),
        company: text("company"),
        contact: text("contact"),
        email,
        phone: text("phone"),
        industry: text("industry"),
        amount: Number(p.amount),
        product: text("product"),
        seller_id: admin ? text("seller_id") : user.id,
        closer_id: null,
        verification: existing?.verification || "pending",
        stage: "new",
        last_contact: null,
        summary: "",
        next_action: text("next_action"),
        next_action_at: new Date(text("next_action_at")).toISOString(),
        created_at: now,
        updated_at: now,
        campaign_id: null,
        application_complete: false,
        application_signed: false,
        handed_off_at: null,
        funded_amount: null,
        funded_at: null,
        funded_lender_id: null,
      };
      if (kind === "create_lead") {
        d.leads.unshift({
          ...created,
          suppressed: false,
          opportunity_id: null,
        });
        break;
      }
      d.opportunities.unshift(created);
      for (let i = 0; i < 5; i++)
        d.documents.push({
          id: id(),
          opportunity_id: created.id,
          name: i ? `Bank Statement ${i}` : "Signed application",
          kind: i ? "bank_statement" : "application",
          period: "",
          bank_name: "",
          statement_number: i || null,
          required: !i,
          status: "pending",
          source: "checklist",
          created_at: now,
        });
      break;
    }
    case "activity":
      required("body");
      activity(text("body"), text("type"));
      if (o && !o.handed_off_at) {
        o.summary = text("body");
        if (p.type === "call") {
          o.last_contact = now;
          o.next_action = text("next_action");
          o.next_action_at = new Date(text("next_action_at")).toISOString();
        }
      }
      break;
    case "next_action":
      required("next_action", "next_action_at");
      if (o) {
        if (!o.handed_off_at) {
          o.next_action = text("next_action");
          o.next_action_at = new Date(text("next_action_at")).toISOString();
        }
        d.tasks.unshift({
          id: id(),
          opportunity_id: o.id,
          owner_id: o.closer_id || o.seller_id,
          title: text("next_action"),
          due_at: new Date(text("next_action_at")).toISOString(),
          status: "open",
          area: o.handed_off_at ? "closer" : "seller",
        });
        activity(text("next_action"));
      }
      break;
    case "transition":
      required("stage", "reason");
      if (o) {
        if (
          !stages.includes(text("stage") as Stage) ||
          ["funded", "unassigned", "ready_for_closer"].includes(text("stage"))
        )
          throw new Error("Use the dedicated transition");
        o.stage = text("stage") as Stage;
        activity(`${o.stage}: ${text("reason")}`);
      }
      break;
    case "analysis":
      required("summary", "conclusion", "recommendations");
      if (!o || o.handed_off_at) throw new Error("Seller phase only");
      d.analyses.unshift({
        id: id(),
        opportunity_id: o.id,
        summary: text("summary"),
        conclusion: text("conclusion"),
        observations: text("observations"),
        recommendations: text("recommendations"),
        reviewer_id: user.id,
        reviewed_at: now,
      });
      activity(text("summary"));
      break;
    case "add_document": {
      if (!o) throw new Error("Case required");
      required("kind");
      const bank = text("bank_name");
      if (text("kind") === "bank_statement") required("bank_name");
      else required("name");
      const number =
        Math.max(
          0,
          ...d.documents
            .filter(
              (doc) =>
                doc.opportunity_id === o.id &&
                doc.kind === "bank_statement" &&
                (doc.bank_name || "").toLowerCase() === bank.toLowerCase(),
            )
            .map((doc) => doc.statement_number || 0),
        ) + 1;
      d.documents.push({
        id: id(),
        opportunity_id: o.id,
        name:
          text("kind") === "bank_statement"
            ? `Bank Statement ${number}`
            : text("name"),
        kind: text("kind"),
        period: "",
        bank_name: text("kind") === "bank_statement" ? bank : "",
        statement_number: text("kind") === "bank_statement" ? number : null,
        required:
          text("kind") !== "bank_statement" &&
          p.required !== "false" &&
          p.required !== false,
        status: "pending",
        source: "checklist",
        created_at: now,
      });
      break;
    }
    case "classify_document": {
      const doc = d.documents.find(
        (doc) => doc.id === p.document_id && doc.opportunity_id === o?.id,
      );
      if (!doc || doc.kind !== "bank_statement")
        throw new Error("Bank statement required");
      required("bank_name");
      if (
        (doc.bank_name || "").toLowerCase() !== text("bank_name").toLowerCase()
      )
        doc.statement_number =
          Math.max(
            0,
            ...d.documents
              .filter(
                (other) =>
                  other.opportunity_id === o?.id &&
                  other.kind === "bank_statement" &&
                  (other.bank_name || "").toLowerCase() ===
                    text("bank_name").toLowerCase(),
              )
              .map((other) => other.statement_number || 0),
          ) + 1;
      doc.bank_name = text("bank_name");
      doc.name = `Bank Statement ${doc.statement_number}`;
      break;
    }
    case "assign_seller": {
      if (!o || !admin) throw new Error("Access denied");
      o.seller_id = text("seller_id");
      activity("Seller reassigned", "assignment");
      break;
    }
    case "review_document": {
      const doc = d.documents.find(
        (doc) =>
          doc.id === (p.document_id || p.id) && doc.opportunity_id === o?.id,
      );
      if (!doc || doc.status === "pending")
        throw new Error("Document not received");
      doc.status = text("status") as typeof doc.status;
      if (p.status === "correction" && !text("notes").trim())
        throw new Error("Explain the requested correction");
      if (p.expected_hash && p.expected_hash !== (doc.content_hash || "demo"))
        throw new Error("Document changed; reopen the review");
      doc.review_notes = text("notes");
      doc.reviewed_by = user.id;
      doc.reviewed_at = now;
      if (typeof p.period === "string") doc.period = p.period;
      activity(`${doc.name}: ${doc.status}`);
      break;
    }
    case "underwriting_settings": {
      if (user.role !== "superadmin") throw new Error("Superadmin required");
      const version = (d.underwriting_settings?.version || 1) + 1;
      d.underwriting_settings = {
        ...(p as unknown as import("./underwriting").UnderwritingSettings),
        id: 1,
        version,
      };
      d.underwriting_setting_versions = [
        {
          version,
          model: String(p.model),
          updated_at: now,
          updated_by: user.id,
        },
        ...(d.underwriting_setting_versions || []),
      ];
      break;
    }
    case "initialize_document_checklist": {
      if (!o) throw new Error("Case required");
      if (d.documents.some((doc) => doc.opportunity_id === o.id)) break;
      d.documents.push({
        id: id(),
        opportunity_id: o.id,
        name: "Signed application",
        kind: "application",
        period: "",
        required: true,
        status: "pending",
        source: "checklist",
        created_at: now,
      });
      for (let offset = 1; offset <= 4; offset++) {
        d.documents.push({
          id: id(),
          opportunity_id: o.id,
          name: `Bank Statement ${offset}`,
          kind: "bank_statement",
          period: "",
          bank_name: "",
          statement_number: offset,
          required: false,
          status: "pending",
          source: "checklist",
          created_at: now,
        });
      }
      activity("Document checklist initialized");
      break;
    }
    case "incorporate_document": {
      const attachment = d.attachments?.find((a) => a.id === p.source_id);
      const message = d.messages.find((m) => m.id === attachment?.message_id);
      const conversation = d.conversations.find(
        (c) => c.id === message?.conversation_id,
      );
      const doc = d.documents.find(
        (d) => d.id === p.document_id && d.opportunity_id === o?.id,
      );
      if (!attachment || !doc || conversation?.opportunity_id !== o?.id)
        throw new Error("Attachment belongs to another opportunity");
      if (
        attachment.imported_document_id &&
        attachment.imported_document_id !== doc.id
      )
        throw new Error("Attachment already incorporated");
      attachment.imported_document_id = doc.id;
      doc.status = "received";
      doc.source = "conversation";
      doc.content_hash = "demo";
      doc.storage_path = "demo";
      doc.review_notes = "";
      doc.reviewed_by = null;
      doc.reviewed_at = null;
      activity(`Document received: ${doc.name}`);
      break;
    }
    case "upload_demo": {
      const doc = d.documents.find(
        (doc) => doc.id === p.document_id && doc.opportunity_id === o?.id,
      );
      if (!doc) throw new Error("Document not found");
      doc.status = "received";
      doc.name = text("name");
      doc.source = "team_upload";
      activity(`Document received: ${doc.name}`);
      break;
    }
    case "handoff":
      if (!o || handoffErrors(o, d.documents, d.analyses).length)
        throw new Error("Expediente incompleto / Incomplete case");
      o.handed_off_at = now;
      o.stage = "unassigned";
      activity("Case handed off");
      break;
    case "assign_closer":
      if (
        !["superadmin", "closer_admin"].includes(user.role) ||
        !o?.handed_off_at
      )
        throw new Error("Access denied");
      o.closer_id = text("closer_id");
      o.stage = "lenders";
      activity(`Closer: ${o.closer_id}`);
      break;
    case "fund":
      if (!o || !closer || !["accepted", "funding_pending"].includes(o.stage))
        throw new Error("Acceptance required before funding");
      required("lender_id", "funded_at");
      if (!(Number(p.amount) > 0)) throw new Error("Invalid amount");
      o.stage = "funded";
      o.funded_amount = Number(p.amount);
      o.funded_at = new Date(text("funded_at")).toISOString();
      o.funded_lender_id = text("lender_id");
      activity("Funding confirmed");
      break;
    case "create_task":
      required("title", "due_at", "opportunity_id", "owner_id");
      if (!o) throw new Error("Case not found");
      d.tasks.unshift({
        id: id(),
        opportunity_id: o.id,
        owner_id: text("owner_id"),
        title: text("title"),
        due_at: new Date(text("due_at")).toISOString(),
        status: "open",
        area: o.handed_off_at ? "closer" : "seller",
      });
      break;
    case "complete_task": {
      const task = d.tasks.find((t) => t.id === p.id);
      const parent = d.opportunities.find((o) => o.id === task?.opportunity_id);
      if (!task || !parent || !canSeeArea(user, parent, task.area))
        throw new Error("Access denied");
      if (parent.handed_off_at && !closer) throw new Error("Read-only case");
      task.status = "done";
      break;
    }
    case "submission":
      if (!o?.handed_off_at || !closer) throw new Error("Closer phase only");
      required("lender_id", "next_action", "next_action_at");
      d.submissions.push({
        id: id(),
        opportunity_id: o.id,
        lender_id: text("lender_id"),
        closer_id: o.closer_id || user.id,
        status: text("channel") === "email" ? "draft" : "submitted",
        channel: text("channel"),
        external_reference: text("external_reference"),
        submitted_at: now,
        next_action: text("next_action"),
        next_action_at: new Date(text("next_action_at")).toISOString(),
      });
      activity("Lender submission recorded");
      break;
    case "update_submission": {
      const s = d.submissions.find(
        (s) => s.id === p.id && s.opportunity_id === o?.id,
      );
      if (!s || !closer) throw new Error("Access denied");
      s.status = text("status");
      s.next_action = text("next_action");
      s.next_action_at = new Date(text("next_action_at")).toISOString();
      break;
    }
    case "offer":
      if (!o || !closer) throw new Error("Access denied");
      d.offers.push({
        id: id(),
        opportunity_id: o.id,
        submission_id: text("submission_id"),
        product: text("product"),
        amount: Number(p.amount),
        term: text("term"),
        cost: text("cost"),
        frequency: text("frequency"),
        fees: text("fees"),
        expires_at: text("expires_at"),
        status: "received",
      });
      o.stage = "offers";
      activity("Offer recorded");
      break;
    case "create_lender":
      if (!["superadmin", "closer_admin"].includes(user.role))
        throw new Error("Access denied");
      required("name");
      if (text("channel") !== "portal") required("email");
      d.lenders.push({
        id: id(),
        name: text("name"),
        email: text("email"),
        products: text("products")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        channel: text("channel"),
        notes: text("notes"),
      });
      break;
    case "update_lender": {
      if (!["superadmin", "closer_admin"].includes(user.role))
        throw new Error("Access denied");
      const lender = d.lenders.find((l) => l.id === p.id);
      if (!lender) throw new Error("Not found");
      Object.assign(lender, {
        name: text("name"),
        email: text("email"),
        products: text("products")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        channel: text("channel"),
        notes: text("notes"),
      });
      break;
    }
    case "create_campaign": {
      if (!admin) throw new Error("Access denied");
      required("name", "account_id", "seller_id", "subject", "body");
      if (Number(p.start_hour) >= Number(p.end_hour))
        throw new Error("Invalid schedule");
      const c: Campaign = {
        id: id(),
        name: text("name"),
        account_id: text("account_id"),
        seller_id: text("seller_id"),
        status: "draft",
        daily_limit: Number(p.daily_limit),
        timezone: text("timezone"),
        start_hour: Number(p.start_hour),
        end_hour: Number(p.end_hour),
        subject: text("subject"),
        body: text("body"),
        steps:
          (p.steps as Campaign["steps"]) ||
          (Number(p.followup_days) > 0
            ? [
                {
                  subject: text("followup_subject"),
                  body: text("followup_body"),
                  wait_days: Number(p.followup_days),
                },
              ]
            : []),
        created_at: now,
        audience_count: d.opportunities.filter(
          (o) => !o.campaign_id && o.verification === "valid",
        ).length,
      };
      renderTemplate(c.subject + c.body, campaignPreviewValues);
      const template = d.email_templates?.find((t) => t.id === p.template_id);
      c.template_id = template?.id;
      c.template_version = template?.version;
      c.asset_snapshot =
        d.campaign_assets?.filter((a) => template?.asset_ids.includes(a.id)) ||
        [];
      c.requires_application = requiresApplication(c.subject, c.body, c.steps);
      d.campaigns.unshift(c);
      break;
    }
    case "activate_campaign":
      throw new Error(
        "La demostración no envía correos. Configura las integraciones para activar campañas. / Demo mode cannot send email.",
      );
    case "pause_campaign": {
      if (!admin) throw new Error("Access denied");
      const c = d.campaigns.find((c) => c.id === p.id);
      if (c) c.status = "paused";
      break;
    }
    case "verify_contacts":
      throw new Error(
        "La demostración no consume créditos de Bouncer. Conecta el proveedor para verificar. / Configure Bouncer to verify.",
      );
    case "reply":
    case "lender_email":
      throw new Error(
        "El correo no se ha enviado: las conexiones externas están deshabilitadas en demo. / Email was not sent: demo integrations are disabled.",
      );
    case "preferences":
      d.preferences = {
        internal: Boolean(p.internal),
        email: Boolean(p.email),
        push: Boolean(p.push),
        locale: p.locale === "en" ? "en" : "es",
      };
      break;
    case "read_notification": {
      const n = d.notifications.find((n) => n.id === p.id);
      if (n) n.read_at = now;
      break;
    }
    case "invite_user":
      throw new Error(
        "Las invitaciones requieren Supabase configurado. / Invitations require a configured Supabase project.",
      );
    case "mail_permission":
    case "user_role":
    case "account_settings":
    case "associate_thread":
    case "request_documents":
    case "import_attachment":
    case "requirements":
      if (user.role !== "superadmin") throw new Error("Access denied");
      throw new Error(
        "La configuración persistente requiere Supabase. / Persistent settings require Supabase.",
      );
    case "import_demo": {
      if (!admin) throw new Error("Access denied");
      const batch = {
        id: id(),
        name: text("name"),
        status: "completed",
        total: (p.rows as unknown[]).length,
        processed: (p.rows as unknown[]).length,
        imported: 0,
        duplicates: 0,
        skipped: 0,
        errors: 0,
        created_at: now,
      };
      for (const row of p.rows as Record<string, string>[]) {
        const normalized = normalizeRow(row, p.mapping as Mapping);
        if (!normalized.valid) {
          batch.errors++;
          continue;
        }
        if (
          d.leads.some((o) => o.email === normalized.email) ||
          d.opportunities.some((o) => o.email === normalized.email)
        ) {
          batch.duplicates++;
          continue;
        }
        batch.imported++;
        d.leads.push({
          id: id(),
          contact_id: id(),
          ...normalized,
          product: "Business loan",
          suppressed: false,
          opportunity_id: null,
          verification: "pending",
          seller_id: user.id,
          amount: 0,
          next_action: "",
          next_action_at: null,
          created_at: now,
        });
      }
      d.imports.unshift(batch);
      break;
    }
    default:
      throw new Error("Unsupported action");
  }
  return d;
}
