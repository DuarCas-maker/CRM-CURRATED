import { z } from "zod";
import type { Opportunity } from "./domain";
import { renderTemplate, templateVariables } from "./domain";
import { renderCampaignContent, type CampaignFormat } from "./campaign-content";

export const lenderMergeFields = [
  "name",
  "company",
  "amount",
  "industry",
  "phone",
  "email",
  "product",
  "lender_name",
] as const;
export const lenderTemplateSchema = z
  .object({
    id: z.uuid(),
    expected_version: z.number().int().min(0),
    name: z.string().trim().min(1).max(200),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().trim().min(1).max(10000),
    body_format: z.enum(["plain", "markdown"]).default("plain"),
    archived: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    const preview = renderLenderMessage(
      p,
      Object.fromEntries(lenderMergeFields.map((k) => [k, "Example"])),
    );
    if (preview.missing.length || preview.error)
      ctx.addIssue({
        code: "custom",
        message: preview.error || "Revisa las variables de la plantilla.",
      });
  });
export interface LenderTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  body_format: CampaignFormat;
  version: number;
  archived_at: string | null;
  updated_at: string;
}
export interface LenderMessage {
  subject: string;
  body: string;
  html: string;
  missing: string[];
  error: string;
}
export interface LenderReview {
  digest: string;
  messages: (LenderMessage & {
    lender_id: string;
    lender_name: string;
    email: string;
    cc_emails: string[];
  })[];
  signature: { html: string; name: string };
}
export function lenderTemplateValues(
  o?: Partial<Opportunity>,
  lenderName = "",
): Record<string, string> {
  return {
    name: o?.contact || "",
    company: o?.company || "",
    email: o?.email || "",
    phone: o?.phone || "",
    industry: o?.industry || "",
    product: o?.product || "",
    amount:
      o?.amount && o.amount > 0
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }).format(o.amount)
        : "",
    lender_name: lenderName,
  };
}
export function renderLenderMessage(
  source: { subject: string; body: string; body_format?: CampaignFormat },
  values: Record<string, string>,
): LenderMessage {
  const vars = [
    ...new Set(templateVariables(source.subject + "\n" + source.body)),
  ];
  const missing = vars.filter(
    (k) =>
      !lenderMergeFields.includes(k as (typeof lenderMergeFields)[number]) ||
      !values[k]?.trim(),
  );
  const safeValues = Object.fromEntries(
    vars.map((k) => [k, missing.includes(k) ? `⟦Falta: ${k}⟧` : values[k]]),
  );
  try {
    const subject = renderTemplate(source.subject, safeValues);
    const rendered = renderCampaignContent(
      source.body,
      safeValues,
      source.body_format,
    );
    // Unbalanced delimiters and CR/LF from a CRM field cannot become mail headers.
    if (
      /[\r\n]/.test(subject) ||
      subject.length > 200 ||
      rendered.text.length > 10000
    )
      throw Error(
        "El asunto o mensaje supera el tamaño permitido o contiene un salto de línea en el asunto.",
      );
    if (
      /{{|}}/.test(
        (source.subject + source.body).replace(/{{\s*([^{}]+?)\s*}}/g, ""),
      )
    )
      throw Error("Revisa las llaves de las variables: {{company}}.");
    return {
      subject,
      body: rendered.text,
      html: rendered.html,
      missing,
      error: "",
    };
  } catch (e) {
    return {
      subject: source.subject,
      body: source.body,
      html: "",
      missing,
      error: (e as Error).message,
    };
  }
}

export function messagePreviewDocument(html: string, signature = "") {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>body{font:14px/1.65 Arial,sans-serif;color:#202723;padding:12px;overflow-wrap:anywhere}table{max-width:100%}a{pointer-events:none}</style><div>${html}</div>${html.includes('data-crm-signature="true"') || !signature ? "" : `<br><div>${signature}</div>`}`;
}
