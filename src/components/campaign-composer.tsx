"use client";
import { useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import type { EmailTemplate } from "@/lib/campaign-templates";
import { campaignPreviewValues } from "@/lib/campaign-templates";
import { renderCampaignContent } from "@/lib/campaign-content";
import type { Action } from "./crm";
import { Field, SaveButton, t } from "./ui";

export function CampaignComposer({
  data,
  locale,
  initialTemplate,
  act,
  close,
}: {
  data: Workspace;
  locale: Locale;
  initialTemplate: EmailTemplate | null;
  act: Action;
  close: () => void;
}) {
  const templates = [
    ...(initialTemplate ? [initialTemplate] : []),
    ...(data.email_templates || []).filter((t) => t.id !== initialTemplate?.id),
  ].filter((t) => !t.archived_at);
  const [templateId, setTemplateId] = useState(initialTemplate?.id || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const template = templates.find((t) => t.id === templateId);
  const accounts = data.accounts.filter(
    (a) =>
      a.status === "connected" &&
      (data.demo ||
        data.profile.role === "superadmin" ||
        data.sender_account_ids?.includes(a.id)),
  );
  let preview = "";
  try {
    if (template)
      preview = renderCampaignContent(
        template.body,
        campaignPreviewValues,
        template.body_format,
      ).html;
  } catch {
    /* Validation on save explains invalid content. */
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!template) return;
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await act("create_campaign", {
            ...Object.fromEntries(form),
            template_id: template.id,
            template_version: template.version,
            subject: template.subject,
            body: template.body,
            steps: template.steps,
            body_format: template.body_format || "plain",
          });
          close();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
        <Field
          name="name"
          label={t(locale, "Nombre de campaña", "Campaign name")}
          required
        />
        <label className="field">
          {t(locale, "Plantilla del sistema", "System template")}
          <select
            required
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">
              {t(locale, "Selecciona una plantilla…", "Choose a template…")}
            </option>
            {templates.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name} · v{t.version}
              </option>
            ))}
          </select>
        </label>
        {!templates.length && (
          <p>
            {t(
              locale,
              "Crea primero una plantilla en la pestaña Plantillas.",
              "Create a template in the Templates tab first.",
            )}
          </p>
        )}
        <div className="form-grid">
          <Field
            name="account_id"
            label={t(locale, "Cuenta remitente", "Sender account")}
            required
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </Field>
          <Field
            name="seller_id"
            label={t(locale, "Seller responsable", "Responsible seller")}
            required
          >
            {data.profiles
              .filter(
                (p) =>
                  p.active !== false &&
                  ["seller", "seller_admin", "superadmin"].includes(p.role),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Field>
          <Field name="batch_id" label={t(locale, "Audiencia", "Audience")}>
            <option value="">
              {t(locale, "Todos los leads disponibles", "All available leads")}
            </option>
            {data.imports.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Field>
          <Field
            name="daily_limit"
            label={t(
              locale,
              "Máximo de esta campaña por 24 h",
              "Campaign maximum per 24h",
            )}
            type="number"
            value={100}
            min={1}
            max={2000}
            required
          />
          <Field
            name="timezone"
            label={t(locale, "Zona horaria", "Time zone")}
            value="America/Bogota"
          >
            {[
              "America/Bogota",
              "America/New_York",
              "America/Chicago",
              "America/Denver",
              "America/Los_Angeles",
            ].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </Field>
          <Field
            name="start_hour"
            label={t(locale, "Hora de inicio", "Start hour")}
            type="number"
            value={9}
            min={0}
            max={23}
            required
          />
          <Field
            name="end_hour"
            label={t(locale, "Hora de fin", "End hour")}
            type="number"
            value={17}
            min={1}
            max={24}
            required
          />
        </div>
        {template && (
          <section className="analysis-card">
            <h3>{template.subject}</h3>
            <div dangerouslySetInnerHTML={{ __html: preview }} />
            <p>
              {template.steps.length} {t(locale, "seguimientos", "follow-ups")}{" "}
              · {template.asset_ids.length}{" "}
              {t(locale, "adjuntos generales", "shared attachments")}
            </p>
            <small>
              {t(
                locale,
                "Ejemplo ilustrativo. Al guardar podrás revisar los clientes reales, exclusiones y mensajes antes de activar.",
                "Sample data. Save to review actual clients, exclusions and messages before activation.",
              )}
            </small>
          </section>
        )}
        <p className="muted">
          {t(
            locale,
            "El cupo de la cuenta se comparte entre todas sus campañas. La campaña conserva esta versión de la plantilla y sus adjuntos.",
            "The account budget is shared across its campaigns. This template version and its attachments are frozen in the campaign.",
          )}
        </p>
        <SaveButton
          locale={locale}
          busy={busy || !template || !accounts.length}
          label={t(locale, "Guardar borrador", "Save draft")}
        />
      </fieldset>
    </form>
  );
}
