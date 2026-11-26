import { z } from "zod";
import { campaignTemplateSchema } from "./campaign-templates";
import { brandPreparationSchema } from "./brand-delivery";

import { reminderDays } from "./campaign-sequence";
export { reminderDays, defaultReminders } from "./campaign-sequence";
export const flowLaunchSchema = z.strictObject({
  account_id: z.uuid(),
  brand_preparation: brandPreparationSchema,
  template_id: z.uuid(),
  template_version: z.number().int().positive(),
  contact_ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((a) => new Set(a).size === a.length),
  scheduled_at: z.iso.datetime(),
  timezone: z
    .string()
    .min(1)
    .max(80)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("es", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
  reminders: campaignTemplateSchema.shape.steps
    .unwrap()
    .length(4)
    .superRefine((a, ctx) => {
      a.forEach((s, i) => {
        if (s.wait_days !== reminderDays[i])
          ctx.addIssue({
            code: "custom",
            message: "La secuencia debe conservar los intervalos 2/3/3/5.",
          });
      });
    }),
});
export interface FlowPool {
  income_scope?: import("./campaign-readiness").IncomeCounts;
  total: number;
  rows: {
    contact_id: string;
    opportunity_id: string;
    name: string;
    email: string;
    company: string;
    monthly_income?: number | null;
  }[];
}
export interface FlowProgress {
  campaign_id: string;
  steps: {
    step: number;
    sent: number;
    waiting: number;
    next_at: string | null;
  }[];
  bounced: number;
  stopped: number;
}
/** Civil-day arithmetic: keep the wall-clock time, then move Sunday to Monday. */
export function nextReminderLocal(local: string, days: number) {
  const d = new Date(local + "Z");
  if (!Number.isFinite(d.getTime()) || !Number.isInteger(days) || days < 0)
    throw new Error("Invalid reminder date");
  d.setUTCDate(d.getUTCDate() + days);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 19);
}
