"use client";
import { useState, useRef, type FormEvent } from "react";
import type { Locale, Opportunity, Workspace } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { Action } from "./crm";
import { Modal, SaveButton, t } from "./ui";

export function MailComposer({
  data,
  locale,
  act,
  busy,
  close,
  opportunity,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  close: () => void;
  opportunity?: Opportunity;
}) {
  const choices = data.opportunities.filter((o) => {
    const p = data.profile;
    return (
      p.role === "superadmin" ||
      (!o.handed_off_at
        ? p.role === "seller_admin" ||
          (p.role === "seller" && o.seller_id === p.id)
        : p.role === "closer_admin" ||
          (p.role === "closer" && o.closer_id === p.id))
    );
  });
  const [caseId, setCaseId] = useState(opportunity?.id || choices[0]?.id || "");
  const selected = opportunity || choices.find((o) => o.id === caseId);
  const accounts = data.accounts.filter(
    (a) => a.status === "connected" && data.sender_account_ids?.includes(a.id),
  );
  const [accountId, setAccountId] = useState(
    accounts.find((a) => a.id === selected?.primary_account_id)?.id ||
      accounts[0]?.id ||
      "",
  );
  const [recipient, setRecipient] = useState(selected?.email || "");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || submitting.current) return;
    submitting.current = true;
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await act("compose_email", {
        opportunity_id: caseId,
        account_id: accountId,
        to_email: recipient.trim(),
        subject: form.get("subject"),
        body: form.get("body"),
        attachment_ids: form.getAll("attachment_id"),
        gmail_file_ids: form.getAll("gmail_file_id"),
      });
      close();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t(
              locale,
              "No se pudo guardar el envío.",
              "Could not queue the email.",
            ),
      );
    } finally {
      submitting.current = false;
    }
  }
  return (
    <Modal
      title={t(locale, "Nuevo correo", "New email")}
      close={() => {
        if (!busy) close();
      }}
    >
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit}>
        <label className="field">
          <span>{t(locale, "Oportunidad", "Opportunity")} *</span>
          <select
            required
            value={caseId}
            disabled={!!opportunity || busy}
            onChange={(e) => {
              setCaseId(e.target.value);
              const o = choices.find((o) => o.id === e.target.value);
              setRecipient(o?.email || "");
              if (accounts.some((a) => a.id === o?.primary_account_id))
                setAccountId(o!.primary_account_id!);
            }}
          >
            <option value="">
              {t(locale, "Seleccionar expediente", "Select a case")}
            </option>
            {(opportunity ? [opportunity] : choices).map((o) => (
              <option key={o.id} value={o.id}>
                {o.company} · {o.contact}
              </option>
            ))}
          </select>
        </label>
        {!choices.length && !opportunity && (
          <p className="muted">
            {t(
              locale,
              "Abre una oportunidad existente para iniciar un correo. Los leads nuevos deben validarse primero; los históricos requieren importación confirmada.",
              "Open an existing opportunity to start an email. New leads require validation; historical cases require confirmed import.",
            )}
          </p>
        )}
        <label className="field">
          <span>{t(locale, "Enviar desde", "Send from")} *</span>
          <select
            required
            value={accountId}
            disabled={busy}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">
              {t(locale, "Seleccionar cuenta", "Select an account")}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </label>
        {!accounts.length && (
          <p className="muted">
            {t(
              locale,
              "Necesitas una cuenta conectada con permiso de envío. Revisa Configuración → Permisos de remitentes.",
              "You need a connected account with sending permission. Check Settings → Sender permissions.",
            )}
          </p>
        )}
        <label className="field">
          <span>{t(locale, "Para", "To")} *</span>
          <input
            type="email"
            required
            maxLength={254}
            value={recipient}
            disabled={busy}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t(locale, "Asunto", "Subject")} *</span>
          <input name="subject" required maxLength={200} disabled={busy} />
        </label>
        <label className="field">
          <span>{t(locale, "Mensaje", "Message")} *</span>
          <textarea
            name="body"
            required
            maxLength={10000}
            rows={6}
            disabled={busy}
          />
        </label>
        <details key={caseId}>
          <summary>
            {t(
              locale,
              "Adjuntar documentos aprobados",
              "Attach approved documents",
            )}
          </summary>
          {data.documents
            .filter(
              (d) =>
                d.opportunity_id === caseId &&
                d.status === "approved" &&
                d.storage_path,
            )
            .map((d) => (
              <label className="document-row" key={d.id}>
                <input
                  type="checkbox"
                  name="attachment_id"
                  value={d.id}
                  disabled={busy}
                />{" "}
                {d.name}
              </label>
            ))}
          {(data.gmail_files || [])
            .filter(
              (f) =>
                f.opportunity_id === caseId &&
                f.status === "approved" &&
                f.storage_path,
            )
            .map((f) => (
              <label className="document-row" key={f.id}>
                <input
                  type="checkbox"
                  name="gmail_file_id"
                  value={f.id}
                  disabled={busy}
                />{" "}
                {f.name}
              </label>
            ))}
        </details>
        <p className="muted">
          {t(
            locale,
            "Revisa el destinatario: el correo quedará vinculado a este expediente. Se pondrá en cola y podrás consultar su estado. No se ejecuta Bouncer ni se inicia una campaña.",
            "Review the recipient: this email will be linked to this case. It will be queued with a visible status. No Bouncer verification or campaign is started.",
          )}
        </p>
        <div className="modal-footer">
          <SaveButton
            locale={locale}
            busy={busy || !caseId || !accountId || data.demo}
            label={t(locale, "Enviar correo", "Send email")}
          />
        </div>
      </form>
    </Modal>
  );
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
