"use client";
import { useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import { renderTemplate } from "@/lib/domain";
import {
  campaignPreviewValues,
  campaignTemplateSchema,
  type EmailTemplate,
  type CampaignAsset,
} from "@/lib/campaign-templates";
import type { Action } from "./crm";
import { Modal, t } from "./ui";

export function CampaignTemplates({
  data,
  locale,
  act,
  useTemplate,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  useTemplate: (template: EmailTemplate) => void;
}) {
  const [templates, setTemplates] = useState(data.email_templates || []);
  const [assets, setAssets] = useState(data.campaign_assets || []);
  const [draft, setDraft] = useState<Partial<EmailTemplate> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const canEdit =
    data.crm_extensions_ready !== false &&
    ["superadmin", "seller_admin"].includes(data.profile.role);
  const update = (patch: Partial<EmailTemplate>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setRequestKey(crypto.randomUUID());
  };
  const preview = (text: string) => {
    try {
      return renderTemplate(text, campaignPreviewValues);
    } catch (e) {
      return (e as Error).message;
    }
  };
  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload = campaignTemplateSchema.parse({
        ...draft,
        expected_version: draft?.version,
      });
      let templateId = draft?.id;
      if (data.demo) {
        templateId ||= crypto.randomUUID();
        await act("campaign_template", { ...payload, id: templateId });
      } else {
        const response = await fetch("/api/campaign-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, request_key: requestKey }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        templateId = result.id;
      }
      const saved = {
        ...payload,
        id: templateId!,
        version: (draft?.version || 0) + 1,
        archived_at: null,
        updated_at: new Date().toISOString(),
      };
      setTemplates((previous) => [
        saved,
        ...previous.filter((v) => v.id !== saved.id),
      ]);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (
        file.size > 10 * 1024 * 1024 ||
        !["application/pdf", "image/png", "image/jpeg"].includes(file.type)
      )
        throw new Error("PDF, PNG o JPG de hasta 10 MB.");
      let asset: CampaignAsset;
      if (data.demo)
        asset = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          mime_type: file.type,
          content_hash: "demo",
          storage_path: "demo",
          created_at: new Date().toISOString(),
        };
      else {
        const form = new FormData();
        form.set("file", file);
        form.set("request_key", crypto.randomUUID());
        const response = await fetch("/api/campaign-templates/assets", {
          method: "POST",
          body: form,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        asset = result;
      }
      setAssets((a) => [asset, ...a]);
      update({ asset_ids: [...(draft?.asset_ids || []), asset.id] });
      if (data.demo) await act("campaign_asset", { asset });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="split-heading">
        <h2>{t(locale, "Plantillas de campañas", "Campaign templates")}</h2>
        {canEdit && (
          <button
            className="button"
            onClick={() => {
              setError("");
              setRequestKey(crypto.randomUUID());
              setDraft({
                name: "",
                subject: "Funding options for {{company}}",
                body: "Hi {{name}},\n\nWe can explore funding for {{company}}.\n\nUnsubscribe: {{unsubscribe_url}}",
                steps: [],
                asset_ids: [],
              });
            }}
          >
            {t(locale, "Nueva plantilla", "New template")}
          </button>
        )}
      </div>
      <p className="muted">
        {t(
          locale,
          "Personaliza cada correo con los datos del cliente. La campaña conserva una copia de la plantilla y sus adjuntos al crearse.",
          "Personalize each email with client data. Campaigns retain a copy of their template and attachments.",
        )}
      </p>
      <div className="campaign-grid">
        {templates
          .filter((v) => !v.archived_at)
          .map((template) => (
            <div className="analysis-card" key={template.id}>
              <h3>{template.name}</h3>
              <p>{template.subject}</p>
              <small>
                v{template.version} · {template.steps.length + 1}{" "}
                {t(locale, "mensajes", "messages")} ·{" "}
                {template.asset_ids.length}{" "}
                {t(locale, "adjuntos", "attachments")}
              </small>
              <div className="card-actions">
                <button
                  className="button"
                  onClick={() => {
                    setError("");
                    setDraft(template);
                  }}
                >
                  {t(
                    locale,
                    canEdit ? "Editar / vista previa" : "Vista previa",
                    canEdit ? "Edit / preview" : "Preview",
                  )}
                </button>
                {canEdit && (
                  <button
                    className="button primary"
                    onClick={() => useTemplate(template)}
                  >
                    {t(locale, "Crear campaña", "Create campaign")}
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
      {!templates.length && (
        <p>
          {t(
            locale,
            "Todavía no hay plantillas guardadas.",
            "No saved templates yet.",
          )}
        </p>
      )}
      {draft && (
        <Modal
          title={t(locale, "Plantilla y vista previa", "Template and preview")}
          close={() => setDraft(null)}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <fieldset
            disabled={!canEdit || busy}
            style={{ border: 0, padding: 0 }}
          >
            <label className="field">
              {t(locale, "Nombre de plantilla", "Template name")}
              <input
                value={draft.name || ""}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label className="field">
              {t(locale, "Asunto", "Subject")}
              <input
                value={draft.subject || ""}
                onChange={(e) => update({ subject: e.target.value })}
              />
            </label>
            <label className="field">
              {t(locale, "Mensaje", "Message")}
              <textarea
                rows={7}
                value={draft.body || ""}
                onChange={(e) => update({ body: e.target.value })}
              />
            </label>
            <p className="muted">
              {Object.keys(campaignPreviewValues)
                .map((key) => `{{${key}}}`)
                .join(" · ")}
            </p>
            {(draft.steps || []).map((step, index) => (
              <section className="analysis-card" key={index}>
                <h3>
                  {t(locale, "Seguimiento", "Follow-up")} {index + 1}
                </h3>
                <label className="field">
                  {t(
                    locale,
                    "Días desde el mensaje anterior",
                    "Days after previous message",
                  )}
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={step.wait_days}
                    onChange={(e) =>
                      update({
                        steps: draft.steps!.map((s, i) =>
                          i === index
                            ? { ...s, wait_days: Number(e.target.value) }
                            : s,
                        ),
                      })
                    }
                  />
                </label>
                <label className="field">
                  {t(locale, "Asunto", "Subject")}
                  <input
                    value={step.subject}
                    onChange={(e) =>
                      update({
                        steps: draft.steps!.map((s, i) =>
                          i === index ? { ...s, subject: e.target.value } : s,
                        ),
                      })
                    }
                  />
                </label>
                <label className="field">
                  {t(locale, "Mensaje", "Message")}
                  <textarea
                    rows={4}
                    value={step.body}
                    onChange={(e) =>
                      update({
                        steps: draft.steps!.map((s, i) =>
                          i === index ? { ...s, body: e.target.value } : s,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="text-button"
                  onClick={() =>
                    update({
                      steps: draft.steps!.filter((_, i) => i !== index),
                    })
                  }
                >
                  {t(locale, "Quitar", "Remove")}
                </button>
              </section>
            ))}
            <button
              className="button"
              disabled={(draft.steps?.length || 0) >= 20}
              onClick={() =>
                update({
                  steps: [
                    ...(draft.steps || []),
                    {
                      subject: "Following up · {{company}}",
                      body: "Hi {{name}}, do you have any questions?\nUnsubscribe: {{unsubscribe_url}}",
                      wait_days: 3,
                    },
                  ],
                })
              }
            >
              {t(locale, "Agregar seguimiento", "Add follow-up")}
            </button>
            <h3>{t(locale, "Adjuntos generales", "General attachments")}</h3>
            <p>
              {t(
                locale,
                "Estos archivos se enviarán a TODOS los destinatarios de la campaña. Máximo 5 archivos y 15 MB en total.",
                "These files will be sent to ALL campaign recipients. Up to 5 files and 15 MB total.",
              )}
            </p>
            {assets.map((asset) => (
              <label className="checkbox" key={asset.id}>
                <input
                  type="checkbox"
                  checked={draft.asset_ids?.includes(asset.id) || false}
                  onChange={(e) =>
                    update({
                      asset_ids: e.target.checked
                        ? [...(draft.asset_ids || []), asset.id]
                        : draft.asset_ids?.filter((id) => id !== asset.id),
                    })
                  }
                />
                {asset.name} · {(asset.size / 1024).toFixed(0)} KB
              </label>
            ))}
            <label className="field">
              {t(locale, "Subir adjunto", "Upload attachment")}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                disabled={(draft.asset_ids?.length || 0) >= 5}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </fieldset>
          <section className="analysis-card">
            <h3>
              {t(
                locale,
                "Vista previa con datos de ejemplo",
                "Preview with sample data",
              )}
            </h3>
            {[
              { subject: draft.subject || "", body: draft.body || "" },
              ...(draft.steps || []),
            ].map((message, index) => (
              <div key={index}>
                <strong>{preview(message.subject)}</strong>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {preview(message.body)}
                </pre>
              </div>
            ))}
          </section>
          {canEdit && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "…" : t(locale, "Guardar plantilla", "Save template")}
            </button>
          )}
        </Modal>
      )}
    </section>
  );
}
