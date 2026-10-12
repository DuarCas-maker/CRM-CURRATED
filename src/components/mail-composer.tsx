"use client";
import type { Locale, Opportunity, Workspace } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { Action } from "./crm";
import { MailEditor } from "./mail-editor";
import { t } from "./ui";
export function MailComposer(props: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  close: () => void;
  opportunity?: Opportunity;
}) {
  return <MailEditor {...props} />;
}

export function MailSendStatus({
  data,
  locale,
  caseId,
}: {
  data: Workspace;
  locale: Locale;
  caseId?: string;
}) {
  const sends = (data.mail_sends || [])
    .filter((s) => !caseId || s.opportunity_id === caseId)
    .slice(0, 20);
  if (!sends.length) return null;
  const labels: Record<string, [string, string]> = {
    queued: ["En cola", "Queued"],
    sending: ["Enviando", "Sending"],
    sent: ["Aceptado por Gmail", "Accepted by Gmail"],
    uncertain: [
      "Resultado incierto: requiere revisión",
      "Uncertain: review required",
    ],
    paused: ["Envío pausado", "Sending paused"],
    cancelled: ["Cancelado", "Cancelled"],
    failed: ["Falló", "Failed"],
  };
  return (
    <section
      className="panel settings-panel"
      aria-label={t(locale, "Estado de envíos", "Sending status")}
    >
      <h2>{t(locale, "Estado de envíos", "Sending status")}</h2>
      {sends.map((s) => (
        <div className="account-row" key={s.id}>
          <div>
            <strong>{s.subject}</strong>
            <small>
              {data.accounts.find((a) => a.id === s.account_id)?.email} →{" "}
              {s.to_email}
            </small>
            {s.status === "queued" &&
              s.last_error?.startsWith("GMAIL_HTTP_") && (
                <small>
                  {t(
                    locale,
                    "Esperando cuota de Gmail. Próximo intento:",
                    "Waiting for Gmail quota. Next attempt:",
                  )}{" "}
                  {dateLabel(s.available_at, locale, true)}
                </small>
              )}
          </div>
          <span className="badge">
            {t(locale, ...(labels[s.status] || [s.status, s.status]))}
          </span>
        </div>
      ))}
      <p className="muted">
        {t(
          locale,
          "Aceptado por Gmail confirma la recepción por la API; comprueba la llegada en el buzón destinatario.",
          "Accepted by Gmail confirms API acceptance; check delivery in the recipient mailbox.",
        )}
      </p>
    </section>
  );
}
