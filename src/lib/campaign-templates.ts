import { z } from "zod";
import { renderTemplate, templateVariables } from "./domain";
import { renderCampaignContent, type CampaignFormat } from "./campaign-content";
export const campaignPreviewValues = {
  name: "Alex",
  company: "Example Business",
  amount: "50000",
  industry: "Retail",
  phone: "555-0100",
  application_url: "https://example.test/apply/preview",
  unsubscribe_url: "https://example.test/unsubscribe/preview",
};
export const campaignTemplateSchema = z
  .object({
    id: z.uuid().optional(),
    expected_version: z.number().int().min(1).optional(),
    name: z.string().trim().min(1).max(200),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n]/.test(v)),
    body: z.string().trim().min(1).max(20000),
    body_format: z.enum(["plain", "markdown"]).default("plain"),
    steps: z
      .array(
        z.object({
          subject: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .refine((v) => !/[\r\n]/.test(v)),
          body: z.string().trim().min(1).max(20000),
          wait_days: z.number().int().min(1).max(90),
        }),
      )
      .max(20)
      .default([]),
    asset_ids: z.array(z.uuid()).max(5).default([]),
  })
  .superRefine((p, ctx) => {
    for (const message of [{ subject: p.subject, body: p.body }, ...p.steps]) {
      if (!message.body.includes("{{unsubscribe_url}}"))
        ctx.addIssue({
          code: "custom",
          message: "Cada mensaje necesita {{unsubscribe_url}}.",
        });
      try {
        renderTemplate(message.subject + message.body, campaignPreviewValues);
        renderCampaignContent(
          message.body,
          campaignPreviewValues,
          p.body_format,
        );
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Variable de plantilla no reconocida.",
        });
      }
    }
    if (new TextEncoder().encode(JSON.stringify(p)).length > 90000)
      ctx.addIssue({
        code: "custom",
        message: "La secuencia completa debe ocupar menos de 90 KB.",
      });
  });
export interface CampaignAsset {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  content_hash: string;
  storage_path: string;
  created_at: string;
}
export interface EmailTemplate {
  body_format?: CampaignFormat;
  id: string;
  name: string;
  subject: string;
  body: string;
  steps: { subject: string; body: string; wait_days: number }[];
  asset_ids: string[];
  version: number;
  archived_at: string | null;
  updated_at: string;
}
export function requiresApplication(
  subject: string,
  body: string,
  steps: { subject: string; body: string }[] = [],
) {
  return [subject, body, ...steps.flatMap((s) => [s.subject, s.body])].some(
    (text) => templateVariables(text).includes("application_url"),
  );
}
