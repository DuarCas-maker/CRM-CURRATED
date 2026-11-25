"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import { renderTemplate } from "@/lib/domain";
import { accountPreparation } from "@/lib/brand-delivery";
import { templatePreviewValues } from "@/lib/campaign-templates";
import { renderCampaignContent } from "@/lib/campaign-content";
import {
  templateReminders,
  withoutInlineSignature,
} from "@/lib/campaign-sequence";
import { CampaignSignaturePreview } from "../campaign-signature-preview";
import { t } from "../ui";
import {
  ProtectedForm,
  markFormSaved,
  useLeaveConfirmation,
} from "../unsaved-changes";

export function FlowComposer({
  data,
  locale,
  contactIds,
  close,
  done,
  initialTemplate,
}: {
  data: Workspace;
  locale: Locale;
  contactIds: string[];
  close: () => void;
  done: (id: string) => Promise<void>;
  initialTemplate?: string;
}) {
  const accounts = data.accounts.filter(
    (a) => a.status === "connected" && a.brand_context?.can_campaign,
  );
  const templates = (data.email_templates || []).filter((t) => !t.archived_at);
  const [account, setAccount] = useState(accounts[0]?.id || ""),
    [templateId, setTemplateId] = useState(
      templates.find((t) => t.id === initialTemplate)?.id ||
        templates[0]?.id ||
        "",
    );
  const { requestLeave, confirmation } = useLeaveConfirmation(locale);
  const sequenceFor = (id: string) => {
    const saved = templates.find((t) => t.id === id)?.steps;
    return templateReminders(
      saved,
      templates.find((t) => t.id === id)?.body_format,
    );
  };
  const [reminders, setReminders] = useState(() => sequenceFor(templateId)),
    [preview, setPreview] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const keys = useRef(new Map<string, string>()),
    root = useRef<HTMLElement>(null);
  const template = templates.find((t) => t.id === templateId),
    sender = accounts.find((a) => a.id === account);
  useEffect(() => {
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const message = preview === 0 ? template : reminders[preview - 1];
  const previewValues = templatePreviewValues(template?.funding_model, sender?.email);
  let subject = "",
    html = "";
  try {
    if (message) {
      subject = renderTemplate(message.subject, previewValues);
      html = renderCampaignContent(
        withoutInlineSignature(message.body, template?.body_format),
        previewValues,
        template?.body_format,
      ).html;
    }
  } catch {
    subject = t(
      locale,
      "Revisa las variables de la plantilla",
      "Check template variables",
    );
  }
  async function send(e: React.FormEvent) {
    const form = e.currentTarget as HTMLFormElement;
    e.preventDefault();
    if (busy || !template || !sender) return;
    setBusy(true);
    setError("");
    try {
      const date = new Date(
        String(new FormData(form).get("scheduled_local") || ""),
      );
      if (
        !Number.isFinite(date.getTime()) ||
        date.getTime() < Date.now() - 60000
      )
        throw Error("Selecciona una fecha y hora de inicio válida.");
      const payload = {
        account_id: account,
        brand_preparation: accountPreparation(sender),
        template_id: template.id,
        template_version: template.version,
        contact_ids: contactIds,
        scheduled_at: date.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reminders,
      };
      const fingerprint = JSON.stringify(payload);
      let key = keys.current.get(fingerprint);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(fingerprint, key);
      }
      const response = await fetch("/api/campaigns/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, request_key: key }),
      });
      const r = await response.json();
      if (!response.ok)
        throw Error(r.error || "No se pudo programar la campaña.");
      markFormSaved(form);
      await done(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      ref={root}
      className="cc-surface cf-composer"
      aria-label="Configurar campaña"
    >
      <div className="cc-section-head">
        <div>
          <span className="cc-kicker">{contactIds.length} LEADS · EMAIL</span>
          <h3>{t(locale, "Configura y programa", "Configure and schedule")}</h3>
        </div>
        <button
          className="pos-btn"
          onClick={() => requestLeave(close)}
          disabled={busy}
        >
          <ArrowLeft size={15} />
          {t(locale, "Volver al lote", "Back to batch")}
        </button>
      </div>
      <div className="cf-compose-grid">
        <ProtectedForm onSubmit={send} busy={busy}>
          <label className="cc-field">
            {t(locale, "Cuenta remitente", "Sender account")}
            <select
              required
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              disabled={busy}
            >
              <option value="">Selecciona una cuenta</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-field">
            {t(locale, "Plantilla del primer correo", "Initial email template")}
            <select
              required
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setReminders(sequenceFor(e.target.value));
              }}
              disabled={busy}
            >
              <option value="">Selecciona una plantilla</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-field">
            <span>
              <CalendarDays size={14} />{" "}
              {t(locale, "Día y hora de inicio", "Start date and time")}
            </span>
            <input
              name="scheduled_local"
              type="datetime-local"
              required
              disabled={busy}
            />
          </label>
          <p className="cc-note">
            {t(
              locale,
              "Hora de tu dispositivo. Los domingos pasan al lunes. El envío respeta el cupo de la cuenta. Los expedientes se asignarán a ti.",
              "Your device's local time. Sundays move to Monday. Sending respects account capacity. Cases will be assigned to you.",
            )}
          </p>
          <details className="cf-reminder-editor">
            <summary>
              {t(
                locale,
                "Revisar y editar los cuatro recordatorios",
                "Review and edit four reminders",
              )}
            </summary>
            <p>
              {t(
                locale,
                "Mismo remitente. Se detienen con una respuesta, baja o rebote. Los intervalos cuentan desde cada envío confirmado.",
                "Same sender. They stop after a reply, opt-out or bounce. Intervals start from each confirmed send.",
              )}
            </p>
            {reminders.map((m, i) => (
              <fieldset key={i}>
                <legend>
                  {i + 1} · +{m.wait_days} {t(locale, "días", "days")}
                </legend>
                <label className="cc-field">
                  Asunto
                  <input
                    required
                    value={m.subject}
                    maxLength={200}
                    disabled={busy}
                    onChange={(e) =>
                      setReminders((a) =>
                        a.map((x, n) =>
                          n === i ? { ...x, subject: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label className="cc-field">
                  Mensaje
                  <textarea
                    required
                    rows={7}
                    value={m.body}
                    maxLength={20000}
                    disabled={busy}
                    onChange={(e) =>
                      setReminders((a) =>
                        a.map((x, n) =>
                          n === i ? { ...x, body: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              </fieldset>
            ))}
          </details>
          {error && (
            <p role="alert" className="pos-alert">
              {error}
            </p>
          )}
          <button
            className="pos-btn pos-primary"
            type="submit"
            disabled={busy || !template || !account || !contactIds.length}
          >
            {busy
              ? t(locale, "Programando…", "Scheduling…")
              : t(
                  locale,
                  `Enviar campaña · ${contactIds.length} leads`,
                  `Send campaign · ${contactIds.length} leads`,
                )}
            <ArrowRight size={15} />
          </button>
        </ProtectedForm>
        <aside className="cf-preview">
          <div className="cf-preview-label">
            {t(
              locale,
              "VISTA PREVIA · DATOS DE EJEMPLO",
              "PREVIEW · EXAMPLE DATA",
            )}
          </div>
          <nav aria-label="Mensajes de la secuencia">
            {[0, 1, 2, 3, 4].map((i) => (
              <button
                key={i}
                className={preview === i ? "selected" : ""}
                aria-pressed={preview === i}
                onClick={() => setPreview(i)}
              >
                {i === 0
                  ? t(locale, "Inicial", "Initial")
                  : `R${i} · +${reminders[i - 1].wait_days}d`}
              </button>
            ))}
          </nav>
          <div className="cf-envelope">
            <small>{sender?.email || "—"} → Alex · Example Business</small>
            <h3>
              {subject || t(locale, "Elige una plantilla", "Select a template")}
            </h3>
            <div
              className="cf-email-body"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) e.preventDefault();
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
            <CampaignSignaturePreview account={sender} locale={locale} />
          </div>
          <p className="cc-note">
            {t(
              locale,
              "El correo real usará los datos de cada lead y la firma de Gmail. No se mide apertura.",
              "Actual emails use each lead's data and the Gmail signature. Opens are not tracked.",
            )}
          </p>
        </aside>
      </div>
      {confirmation}
    </section>
  );
}
