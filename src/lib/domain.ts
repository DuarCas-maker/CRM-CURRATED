export type Locale = "es" | "en";
export type Role =
  "superadmin" | "seller_admin" | "seller" | "closer_admin" | "closer";
export const stages = [
  "new",
  "contacting",
  "replied",
  "application_pending",
  "documents_pending",
  "analysis",
  "ready_for_closer",
  "unassigned",
  "lenders",
  "offers",
  "negotiation",
  "accepted",
  "funding_pending",
  "funded",
  "lost",
  "paused",
] as const;
export type Stage = (typeof stages)[number];
export type Verification = "pending" | "valid" | "invalid" | "uncertain";
export type Area = "seller" | "closer" | "general";
export interface Profile {
  id: string;
  name: string;
  email: string;
  role: Role;
  active?: boolean;
}
export interface Opportunity {
  primary_account_id?: string | null;
  historical_approved_at?: string | null;
  id: string;
  contact_id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  industry: string;
  amount: number;
  product: string;
  stage: Stage;
  verification: Verification;
  seller_id: string;
  closer_id: string | null;
  last_contact: string | null;
  summary: string;
  next_action: string;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
  campaign_id: string | null;
  application_signed: boolean;
  application_complete: boolean;
  handed_off_at: string | null;
  funded_amount: number | null;
  funded_at: string | null;
  funded_lender_id: string | null;
}
export interface Lead {
  id: string;
  contact_id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  industry: string;
  product: string;
  amount: number;
  seller_id: string;
  next_action: string;
  next_action_at: string | null;
  verification: Verification;
  verification_state?: string | null;
  suppressed: boolean;
  opportunity_id: string | null;
  created_at: string;
}
export interface Activity {
  id: string;
  opportunity_id: string;
  actor_id: string;
  type: string;
  area: Area;
  body: string;
  created_at: string;
}
export interface Task {
  id: string;
  opportunity_id: string;
  owner_id: string;
  title: string;
  due_at: string;
  status: "open" | "done";
  area: Area;
}
export interface Document {
  id: string;
  opportunity_id: string;
  name: string;
  kind: string;
  period: string;
  status: "pending" | "received" | "approved" | "correction";
  source: string;
  created_at: string;
  storage_path?: string;
  required?: boolean;
}
export interface Analysis {
  id: string;
  opportunity_id: string;
  summary: string;
  conclusion: string;
  observations: string;
  recommendations: string;
  reviewer_id: string;
  reviewed_at: string;
}
export interface Lender {
  id: string;
  name: string;
  products: string[];
  email: string;
  channel: string;
  notes: string;
}
export interface Submission {
  process_id?: string | null;
  id: string;
  opportunity_id: string;
  lender_id: string;
  closer_id: string;
  status: string;
  channel: string;
  submitted_at: string;
  next_action: string;
  next_action_at: string;
  external_reference: string;
}
export interface Offer {
  id: string;
  submission_id: string;
  opportunity_id: string;
  product: string;
  amount: number;
  term: string;
  cost: string;
  frequency: string;
  fees: string;
  expires_at: string;
  status: string;
}
export interface MailAccount {
  id: string;
  email: string;
  organization: string;
  status: string;
  daily_limit: number;
  timezone: string;
  sent_today: number;
}
export interface Campaign {
  id: string;
  name: string;
  account_id: string;
  seller_id: string;
  status: string;
  daily_limit: number;
  timezone: string;
  start_hour: number;
  end_hour: number;
  subject: string;
  body: string;
  steps: { subject: string; body: string; wait_days: number }[];
  created_at: string;
  audience_count: number;
}
export interface ImportBatch {
  id: string;
  name: string;
  status: string;
  total: number;
  processed: number;
  imported: number;
  duplicates: number;
  skipped: number;
  errors: number;
  created_at: string;
}
export interface Conversation {
  process_id?: string | null;
  recipient_email?: string | null;
  id: string;
  opportunity_id: string;
  submission_id: string | null;
  account_id: string;
  subject: string;
  area: Area;
  needs_attention: boolean;
  updated_at: string;
}
export interface Message {
  participants?: import("./mail-display").MailPeer[];
  internet_message_id?: string;
  sender_team?: import("./gmail-team").TeamLabel;
  archive_message_id?: string | null;
  nature?: string;
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: string;
  body: string;
  sent_at: string;
  status: string;
  area?: Area;
}
export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
export interface Preferences {
  internal: boolean;
  email: boolean;
  push: boolean;
  locale: Locale;
}
export interface Workspace {
  lender_contacts?: { email: string; lender_id: string }[];
  sender_account_ids?: string[];
  mail_sends?: {
    id: string;
    status: string;
    account_id: string;
    opportunity_id: string;
    to_email: string;
    subject: string;
    available_at: string;
    last_error: string | null;
    created_at: string;
  }[];
  gmail_history_enabled?: boolean;
  gmail_files?: {
    id: string;
    opportunity_id: string;
    archive_message_id: string;
    name: string;
    status: string;
    storage_path: string | null;
  }[];
  profile: Profile;
  profiles: Profile[];
  opportunities: Opportunity[];
  leads: Lead[];
  tasks: Task[];
  activities: Activity[];
  documents: Document[];
  analyses: Analysis[];
  lenders: Lender[];
  submissions: Submission[];
  offers: Offer[];
  accounts: MailAccount[];
  campaigns: Campaign[];
  imports: ImportBatch[];
  conversations: Conversation[];
  messages: Message[];
  notifications: Notification[];
  preferences: Preferences;
  demo: boolean;
  mail_review?: {
    id: string;
    account_id: string;
    reason: string;
    status: string;
  }[];
  attachments?: {
    id: string;
    message_id: string;
    name: string;
    size: number;
    imported_document_id: string | null;
  }[];
  integration_jobs?: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
    created_at: string;
  }[];
  outbox_status?: { id: string; status: string; account_id: string }[];
  hasMore?: boolean;
  page?: number;
  listTotal?: number;
  stats?: {
    imported: number;
    owners: { id: string; total: number; amount: number }[];
    stage_days: Partial<Record<Stage, number>>;
    total: number;
    active_count: number;
    active_amount: number;
    funded_count: number;
    funded_amount: number;
    review_count: number;
    verified: number;
    contacted: number;
    applications: number;
    transferred: number;
    offers: number;
    without_action: number;
    overdue: number;
    unread: number;
    stage_counts: Partial<Record<Stage, number>>;
  };
}
export const stageLabels: Record<Locale, Record<Stage, string>> = {
  es: {
    new: "Nuevo",
    contacting: "Contactando",
    replied: "Respondió",
    application_pending: "Aplicación pendiente",
    documents_pending: "Documentos pendientes",
    analysis: "En análisis",
    ready_for_closer: "Listo para closer",
    unassigned: "Por asignar",
    lenders: "En gestión con lenders",
    offers: "Con ofertas",
    negotiation: "En negociación",
    accepted: "Aceptado",
    funding_pending: "Pendiente de desembolso",
    funded: "Desembolsado",
    lost: "Perdido",
    paused: "En pausa",
  },
  en: {
    new: "New",
    contacting: "Contacting",
    replied: "Replied",
    application_pending: "Application pending",
    documents_pending: "Documents pending",
    analysis: "In review",
    ready_for_closer: "Ready for closer",
    unassigned: "Awaiting assignment",
    lenders: "With lenders",
    offers: "Offers received",
    negotiation: "Negotiating",
    accepted: "Accepted",
    funding_pending: "Funding pending",
    funded: "Funded",
    lost: "Lost",
    paused: "On hold",
  },
};
export const roleLabels: Record<Role, string> = {
  superadmin: "Superadmin",
  seller_admin: "Admin sellers",
  seller: "Seller",
  closer_admin: "Admin closers",
  closer: "Closer",
};
export const isSellerRole = (role: Role) =>
  ["superadmin", "seller_admin", "seller"].includes(role);
export const isCloserRole = (role: Role) =>
  ["superadmin", "closer_admin", "closer"].includes(role);
export function canSeeOpportunity(profile: Profile, o: Opportunity): boolean {
  return (
    profile.role === "superadmin" ||
    profile.role === "seller_admin" ||
    (profile.role === "seller" && o.seller_id === profile.id) ||
    (profile.role === "closer_admin" && !!o.handed_off_at) ||
    (profile.role === "closer" && o.closer_id === profile.id)
  );
}
export function canSeeArea(
  profile: Profile,
  o: Opportunity,
  area: Area,
): boolean {
  return (
    canSeeOpportunity(profile, o) &&
    (area !== "closer" || isCloserRole(profile.role))
  );
}
export function handoffErrors(
  o: Opportunity,
  documents: Document[],
  analyses: Analysis[],
): string[] {
  const errors: string[] = [];
  if (!o.application_complete || !o.application_signed)
    errors.push("application");
  const required = documents.filter(
    (d) => d.opportunity_id === o.id && d.required !== false,
  );
  if (required.length === 0 || required.some((d) => d.status !== "approved"))
    errors.push("documents");
  if (
    !analyses.some(
      (a) =>
        a.opportunity_id === o.id &&
        a.summary.trim() &&
        a.conclusion.trim() &&
        a.recommendations.trim(),
    )
  )
    errors.push("analysis");
  return errors;
}
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
export function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
export function templateVariables(text: string): string[] {
  return [...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((m) => m[1]);
}
export function renderTemplate(
  text: string,
  values: Record<string, string>,
): string {
  return text.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key: string) => {
    if (!values[key]?.trim()) throw new Error(`Unresolved variable: ${key}`);
    return values[key];
  });
}
export function eligibleForCampaign(
  v: Verification,
  suppressed: boolean,
  active: boolean,
): boolean {
  return v === "valid" && !suppressed && !active;
}
export function mapVerification(status: string): Verification {
  if (status === "deliverable") return "valid";
  if (status === "undeliverable") return "invalid";
  return "uncertain";
}
export const currency = (n: number, locale: Locale = "es") =>
  new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export const dateLabel = (
  value: string | null,
  locale: Locale,
  withTime = false,
) =>
  value
    ? new Intl.DateTimeFormat(locale === "es" ? "es" : "en", {
        day: "numeric",
        month: "short",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      }).format(new Date(value))
    : "—";
