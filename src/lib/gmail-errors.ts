const reasons = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "quotaExceeded",
  "authError",
  "insufficientPermissions",
  "domainPolicy",
  "accessNotConfigured",
  "forbidden",
  "backendError",
  "SERVICE_DISABLED",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "RATE_LIMIT_EXCEEDED",
  "QUOTA_EXCEEDED",
]);

export class GmailError extends Error {
  public reason: string;
  public operation?: string;
  public unitsPerMinute?: number;
  constructor(
    public status: number,
    reason = "",
    public retryAfter = 0,
  ) {
    super(`GMAIL_HTTP_${status}`);
    this.reason = reasons.has(reason) ? reason : "";
  }
  get code() {
    return `${this.message}${this.reason ? `_${this.reason}` : ""}`;
  }
}

export function isGmailQuotaError(error: unknown): error is GmailError {
  return (
    error instanceof GmailError &&
    (error.status === 429 ||
      [
        "rateLimitExceeded",
        "userRateLimitExceeded",
        "dailyLimitExceeded",
        "quotaExceeded",
        "RATE_LIMIT_EXCEEDED",
        "QUOTA_EXCEEDED",
      ].includes(error.reason))
  );
}

export async function gmailResponseError(response: Response) {
  const body = await response.json().catch(() => ({}));
  const details = [
    ...(Array.isArray(body?.error?.errors) ? body.error.errors : []),
    ...(Array.isArray(body?.error?.details) ? body.error.details : []),
  ];
  const reason = details
    .map((detail: { reason?: unknown } | null) => detail?.reason)
    .find((value: unknown) => typeof value === "string" && reasons.has(value));
  const retry = response.headers.get("retry-after") || "";
  const seconds = /^\d+(?:\.\d+)?$/.test(retry)
    ? Number(retry)
    : (Date.parse(retry) - Date.now()) / 1000;
  // Persist only known reason codes, never Google's raw text, URLs or token data.
  return new GmailError(
    response.status,
    typeof reason === "string" ? reason : "",
    Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0,
  );
}

export function gmailRunErrorMessage(code: string, locale: "es" | "en") {
  const reason = code.match(/^GMAIL_HTTP_\d+_(.*)$/)?.[1] || "";
  const es = locale === "es";
  if (
    /^GMAIL_HTTP_429(?:_|$)/.test(code) ||
    [
      "rateLimitExceeded",
      "userRateLimitExceeded",
      "quotaExceeded",
      "RATE_LIMIT_EXCEEDED",
      "QUOTA_EXCEEDED",
    ].includes(reason)
  )
    return es
      ? "Gmail limitó temporalmente las consultas. El análisis conserva su progreso y reintentará automáticamente."
      : "Gmail temporarily limited requests. Analysis preserves its progress and will retry automatically.";
  if (reason === "dailyLimitExceeded")
    return es
      ? "Se alcanzó una cuota diaria del proyecto de Google. Revisa las cuotas de Gmail API en Google Cloud; el progreso está guardado."
      : "A daily Google project quota was reached. Review Gmail API quotas in Google Cloud; progress is saved.";
  if (reason === "domainPolicy")
    return es
      ? "Google Workspace bloqueó el acceso a Gmail por una política del dominio. El administrador debe permitir esta aplicación antes de reautorizar y reanudar."
      : "A Google Workspace domain policy blocked Gmail access. Ask the administrator to allow this app before reauthorizing and resuming.";
  if (
    [
      "insufficientPermissions",
      "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      "authError",
    ].includes(reason) ||
    /^GMAIL_HTTP_401(?:_|$)/.test(code)
  )
    return es
      ? "La autorización de Gmail debe renovarse. Autoriza nuevamente la cuenta con los permisos solicitados y reanuda este análisis."
      : "Gmail authorization must be renewed. Reauthorize the account with the requested permissions and resume this analysis.";
  if (["accessNotConfigured", "SERVICE_DISABLED"].includes(reason))
    return es
      ? "Gmail API no está habilitada para el proyecto OAuth. Habilítala en Google Cloud y luego reautoriza la cuenta y reanuda."
      : "Gmail API is disabled for the OAuth project. Enable it in Google Cloud, then reauthorize the account and resume.";
  if (/^GMAIL_HTTP_403(?:_|$)/.test(code))
    return es
      ? "Gmail devolvió un error 403. Este código por sí solo no identifica la causa. El progreso está guardado; revisa el motivo técnico y el estado del análisis."
      : "Gmail returned error 403. This code alone does not identify the cause. Progress is saved; review the technical reason and analysis status.";
  return code;
}
