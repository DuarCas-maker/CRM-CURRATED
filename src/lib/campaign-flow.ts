import { z } from "zod";
import { campaignTemplateSchema } from "./campaign-templates";
import { brandPreparationSchema } from "./brand-delivery";

export const reminderDays = [2, 3, 3, 5] as const;
export const defaultReminders = reminderDays.map((wait_days, i) => ({
  subject: [
    "¿Podemos ayudarte?",
    "Seguimos disponibles para {{company}}",
    "¿Quieres continuar la conversación?",
    "Un último mensaje de seguimiento",
  ][i],
  body: [
    "Hola,\n\nTe escribimos para dar seguimiento a nuestro correo anterior sobre {{company}}. Si te interesa continuar, puedes responder directamente a este mensaje.\n\nGracias.\n\nPara dejar de recibir estos mensajes: {{unsubscribe_url}}",
    "Hola,\n\n¿Tuviste oportunidad de revisar nuestro mensaje? Si necesitas más información o prefieres que lo retomemos en otro momento, cuéntanos respondiendo a este correo.\n\nGracias.\n\nPara dejar de recibir estos mensajes: {{unsubscribe_url}}",
    "Hola,\n\nSeguimos disponibles para resolver tus preguntas. Si quieres continuar con la conversación sobre {{company}}, responde a este mensaje y te orientamos con los siguientes pasos.\n\nGracias.\n\nPara dejar de recibir estos mensajes: {{unsubscribe_url}}",
    "Hola,\n\nEste es nuestro último recordatorio de esta secuencia. Si te interesa retomar la conversación más adelante, puedes responder a este correo cuando lo necesites.\n\nGracias por tu tiempo.\n\nPara dejar de recibir estos mensajes: {{unsubscribe_url}}",
  ][i],
  wait_days,
}));
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
  total: number;
  rows: {
    contact_id: string;
    opportunity_id: string;
    name: string;
    email: string;
    company: string;
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
