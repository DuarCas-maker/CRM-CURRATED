import { z } from "zod";

export const reviewFilters = [
  "attention",
  "technical",
  "reconciliation",
  "uncertain",
  "valid",
  "invalid",
  "all",
] as const;
export const importRetrySchema = z
  .object({
    kind: z.literal("retry"),
    batch: z.uuid(),
    contact_ids: z.array(z.uuid()).min(1).max(5000),
    expected_count: z.number().int().min(1).max(5000),
    request_key: z.uuid(),
  })
  .strict()
  .refine(
    (p) =>
      new Set(p.contact_ids).size === p.expected_count &&
      p.contact_ids.length === p.expected_count,
  );
const count = z.number().int().nonnegative();
export const importReviewSchema = z.object({
  total: count,
  summary: z.object({
    attention: count,
    technical: count,
    reconciliation: count,
    running: count,
    insufficient_credits: count,
  }),
  rows: z.array(
    z.object({
      contact_id: z.uuid(),
      name: z.string(),
      company: z.string(),
      email: z.string(),
      verification: z.string(),
      state: z.string().nullable(),
      reason_code: z.string().nullable(),
      retryable: z.boolean(),
      attempted_at: z.string().nullable(),
    }),
  ),
});
export type ImportReview = z.infer<typeof importReviewSchema>;
export function verificationReason(
  row: Pick<
    ImportReview["rows"][number],
    "state" | "verification" | "reason_code"
  >,
  locale: "es" | "en",
) {
  const msg = (es: string, en: string) => (locale === "es" ? es : en);
  if (["uncertain_request", "review"].includes(row.state || ""))
    return msg(
      "Solicitud de resultado incierto. Requiere conciliación; no se puede repetir.",
      "Request outcome unknown. Reconciliation is required; retry is blocked.",
    );
  if (row.state === "technical_error") {
    const reasons: Record<string, [string, string]> = {
      provider_http_402: [
        "Última solicitud rechazada por créditos insuficientes. Revisa el saldo de Bouncer antes de reintentar.",
        "Last request rejected for insufficient credits. Check your Bouncer balance before retrying.",
      ],
      provider_http_401: [
        "Bouncer rechazó la credencial. Revisa la conexión antes de reintentar.",
        "Bouncer rejected the credential. Check the connection before retrying.",
      ],
      provider_http_403: [
        "Bouncer denegó la solicitud. Revisa los permisos del servicio.",
        "Bouncer denied the request. Check service permissions.",
      ],
      provider_http_400: [
        "Bouncer rechazó los datos de la solicitud. Revisa su formato.",
        "Bouncer rejected the request data. Check the format.",
      ],
      provider_http_429: [
        "Se alcanzó el límite de solicitudes de Bouncer. Espera antes de reintentar.",
        "Bouncer's request limit was reached. Wait before retrying.",
      ],
    };
    return (reasons[row.reason_code || ""] || [
      "Error técnico. Resuelve la causa antes de reintentar.",
      "Technical error. Resolve the cause before retrying.",
    ])[locale === "es" ? 0 : 1];
  }
  if (["queued", "submitted"].includes(row.state || ""))
    return msg("Verificación en curso.", "Verification in progress.");
  return (
    {
      valid: msg("Correo válido.", "Valid email."),
      invalid: msg(
        "Correo inválido; excluido del envío.",
        "Invalid email; excluded from sending.",
      ),
      uncertain: msg(
        "Correo dudoso; excluido del envío.",
        "Uncertain email; excluded from sending.",
      ),
    }[row.verification] ||
    msg("Pendiente de verificación.", "Pending verification.")
  );
}
