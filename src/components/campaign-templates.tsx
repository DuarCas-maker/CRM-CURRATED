"use client";
import { useEffect, useRef, useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import { renderTemplate } from "@/lib/domain";
import {
  campaignPreviewValues,
  campaignTemplateSchema,
  type EmailTemplate,
  type CampaignAsset,
} from "@/lib/campaign-templates";
import type { Action } from "./crm";
import { useUnsavedChanges } from "./unsaved-changes";
import { Modal, t } from "./ui";
import { CampaignEditor } from "./campaign-editor";
import { renderCampaignContent } from "@/lib/campaign-content";
import { campaignPresets } from "@/lib/campaign-presets";
import {
  automaticSignatureTemplate,
  templateReminders,
  withoutInlineSignature,
} from "@/lib/campaign-sequence";
import { CampaignSignaturePreview } from "./campaign-signature-preview";

export function CampaignTemplates({
  data,
  locale,
  act,
  useTemplate,
  changed,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  useTemplate: (template: EmailTemplate) => void;
  changed?: () => Promise<void>;
}) {
  const [templates, setTemplates] = useState(data.email_templates || []);
  const [assets, setAssets] = useState(data.campaign_assets || []);
  const [draft, setDraft] = useState<Partial<EmailTemplate> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [showArchived, setShowArchived] = useState(false);
  const [history, setHistory] = useState<EmailTemplate[]>([]);
  const [messageIndex, setMessageIndex] = useState(0);
  const accounts = data.accounts.filter(
    (a) => a.status === "connected" && a.brand_context?.can_campaign,
  );
  const [senderId, setSenderId] = useState(accounts[0]?.id || "");
  const sender = accounts.find((a) => a.id === senderId);
  function openTemplate(value: Partial<EmailTemplate>) {
    setMessageIndex(0);
    setDraft({
      ...value,
      body: withoutInlineSignature(value.body || "", value.body_format),
      steps: templateReminders(value.steps, value.body_format),
    });
  }
  useEffect(() => {
    setTemplates(data.email_templates || []);
    setAssets(data.campaign_assets || []);
  }, [data.email_templates, data.campaign_assets]);
  const changes = useUnsavedChanges(draft, busy);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (draft && !wasOpen.current) changes.markSaved();
    wasOpen.current = !!draft;
  }, [draft]);
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
  function previewHtml(body: string) {
    try {
      return renderCampaignContent(
        withoutInlineSignature(body, draft?.body_format),
        campaignPreviewValues,
        draft?.body_format,
      ).html;
    } catch (e) {
      return null;
    }
  }
  async function archive(template: EmailTemplate) {
    setBusy(true);
    setError("");
    try {
      await act("archive_campaign_template", {
        id: template.id,
        expected_version: template.version,
        archived: !template.archived_at,
      });
      setTemplates((rows) =>
        rows.map((row) =>
          row.id === template.id
            ? {
                ...row,
                version: template.version + 1,
                archived_at: template.archived_at
                  ? null
                  : new Date().toISOString(),
              }
            : row,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory(template: EmailTemplate) {
    setError("");
    setHistory([]);
    try {
      if (data.demo) {
        setHistory([template]);
        return;
      }
      const response = await fetch(`/api/campaign-templates?id=${template.id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setHistory(
        result.map((row: { snapshot: EmailTemplate }) => row.snapshot),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const payload = campaignTemplateSchema.parse(
        automaticSignatureTemplate({
          ...draft,
          body: draft?.body || "",
          steps: templateReminders(draft?.steps, draft?.body_format),
          expected_version: draft?.version,
        }),
      );
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
      await changed?.();
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
        <h2>
          {t(
            locale,
            "Plantillas y recordatorios",
            "Email templates and reminders",
          )}
        </h2>
        {canEdit && (
          <button
            className="button"
            onClick={() => {
              setError("");
              setRequestKey(crypto.randomUUID());
              openTemplate({
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
      {canEdit && (
        <details style={{ marginBottom: 16 }}>
          <summary>
            {t(
              locale,
              "Crear desde las plantillas de referencia de Curated",
              "Create from Curated reference templates",
            )}
          </summary>
          <div className="card-actions" style={{ marginTop: 8 }}>
            {campaignPresets.map((preset) => (
              <button
                type="button"
                className="button"
                key={preset.id}
                onClick={() => {
                  setError("");
                  setRequestKey(crypto.randomUUID());
                  openTemplate({ ...preset, id: undefined });
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </details>
      )}
      {error && !draft && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        {t(locale, "Mostrar archivadas", "Show archived")}
      </label>
      <div className="campaign-grid">
        {templates
          .filter((v) => showArchived || !v.archived_at)
          .map((template) => (
            <div className="analysis-card" key={template.id}>
              <h3>{template.name}</h3>
              {template.archived_at && (
                <span className="badge">
                  {t(locale, "Archivada", "Archived")}
                </span>
              )}
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
                    openTemplate(template);
                  }}
                >
                  {t(
                    locale,
                    canEdit ? "Editar / vista previa" : "Vista previa",
                    canEdit ? "Edit / preview" : "Preview",
                  )}
                </button>
                {canEdit && !template.archived_at && (
                  <button
                    className="button primary"
                    onClick={() => useTemplate(template)}
                  >
                    {t(locale, "Crear campaña", "Create campaign")}
                  </button>
                )}
                {canEdit && (
                  <>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setRequestKey(crypto.randomUUID());
                        openTemplate({
                          ...template,
                          steps: template.steps,
                          id: undefined,
                          version: undefined,
                          archived_at: null,
                          name: `${template.name} (${t(locale, "copia", "copy")})`,
                        });
                      }}
                    >
                      {t(locale, "Duplicar", "Duplicate")}
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => void archive(template)}
                    >
                      {t(
                        locale,
                        template.archived_at ? "Restaurar" : "Archivar",
                        template.archived_at ? "Restore" : "Archive",
                      )}
                    </button>
                  </>
                )}
                <button
                  className="button"
                  onClick={() => void loadHistory(template)}
                >
                  {t(locale, "Historial", "History")}
                </button>
              </div>
            </div>
          ))}
      </div>
      {history.length > 0 && (
        <Modal
          locale={locale}
          title={t(locale, "Historial de versiones", "Version history")}
          close={() => setHistory([])}
        >
          {history.map((version) => (
            <section className="analysis-card" key={version.version}>
              <h3>
                {version.name} · v{version.version}
              </h3>
              <small>{new Date(version.updated_at).toLocaleString()}</small>
              <strong style={{ display: "block" }}>{version.subject}</strong>
              <pre style={{ whiteSpace: "pre-wrap" }}>{version.body}</pre>
              <small>
                {version.steps.length} {t(locale, "seguimientos", "follow-ups")}{" "}
                · {version.asset_ids.length}{" "}
                {t(locale, "adjuntos", "attachments")}
              </small>
            </section>
          ))}
        </Modal>
      )}
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
          locale={locale}
          busy={busy}
          dirty={changes.dirty}
          title={t(locale, "Plantilla y vista previa", "Template and preview")}
          close={() => setDraft(null)}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <nav
            className="campaign-message-tabs"
            aria-label={t(
              locale,
              "Mensajes de la plantilla",
              "Template messages",
            )}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <button
                type="button"
                key={i}
                aria-pressed={messageIndex === i}
                className={`button ${messageIndex === i ? "primary" : ""}`}
                onClick={() => setMessageIndex(i)}
              >
                {i === 0
                  ? t(locale, "Correo principal", "Initial email")
                  : t(locale, `Recordatorio ${i}`, `Reminder ${i}`)}
              </button>
            ))}
          </nav>
          <fieldset
            disabled={!canEdit || busy || !!draft.archived_at}
            style={{ border: 0, padding: 0 }}
          >
            <label className="field">
              {t(locale, "Nombre de plantilla", "Template name")}
              <input
                value={draft.name || ""}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <h3>
              {messageIndex === 0
                ? t(locale, "Correo principal", "Initial email")
                : t(
                    locale,
                    `Recordatorio ${messageIndex} · +${draft.steps?.[messageIndex - 1]?.wait_days} días`,
                    `Reminder ${messageIndex} · +${draft.steps?.[messageIndex - 1]?.wait_days} days`,
                  )}
            </h3>
            <label className="field">
              {t(locale, "Asunto", "Subject")}
              <input
                value={
                  messageIndex === 0
                    ? draft.subject || ""
                    : draft.steps?.[messageIndex - 1]?.subject || ""
                }
                onChange={(e) =>
                  messageIndex === 0
                    ? update({ subject: e.target.value })
                    : update({
                        steps: templateReminders(
                          draft.steps,
                          draft.body_format,
                        ).map((s, i) =>
                          i === messageIndex - 1
                            ? { ...s, subject: e.target.value }
                            : s,
                        ),
                      })
                }
              />
            </label>
            <CampaignEditor
              locale={locale}
              label={t(locale, "Mensaje", "Message")}
              value={
                messageIndex === 0
                  ? draft.body || ""
                  : draft.steps?.[messageIndex - 1]?.body || ""
              }
              onChange={(body) =>
                messageIndex === 0
                  ? update({ body })
                  : update({
                      steps: templateReminders(
                        draft.steps,
                        draft.body_format,
                      ).map((s, i) =>
                        i === messageIndex - 1 ? { ...s, body } : s,
                      ),
                    })
              }
              format={draft.body_format || "plain"}
              onFormat={(body_format) => update({ body_format })}
            />
            <p className="muted">
              {Object.keys(campaignPreviewValues)
                .map((key) => `{{${key}}}`)
                .join(" · ")}
            </p>
            <p className="muted">
              {t(
                locale,
                "Firma automática: cada mensaje usará la firma de Gmail de la cuenta elegida. No escribas aquí una firma personal fija. Los cuatro recordatorios se guardan con esta plantilla para campañas nuevas.",
                "Automatic signature: each message uses the selected account's Gmail signature. Do not type a fixed personal signature here. The four reminders are saved with this template for new campaigns.",
              )}
            </p>
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
            <label className="field">
              {t(locale, "Remitente para la vista previa", "Preview sender")}
              <select
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
              >
                <option value="">
                  {t(locale, "Selecciona una cuenta", "Select an account")}
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </label>
            {[
              messageIndex === 0
                ? { subject: draft.subject || "", body: draft.body || "" }
                : draft.steps?.[messageIndex - 1],
            ]
              .filter(Boolean)
              .map((message) => (
                <div key={messageIndex}>
                  <strong>{preview(message!.subject)}</strong>
                  {previewHtml(message!.body) !== null ? (
                    <div
                      style={{ overflowWrap: "anywhere" }}
                      dangerouslySetInnerHTML={{
                        __html: previewHtml(message!.body)!,
                      }}
                    />
                  ) : (
                    <p className="error">{preview(message!.body)}</p>
                  )}
                </div>
              ))}
            <CampaignSignaturePreview account={sender} locale={locale} />
          </section>
          {canEdit && !draft.archived_at && (
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
