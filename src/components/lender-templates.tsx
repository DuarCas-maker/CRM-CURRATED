"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Plus, RefreshCw, ArrowUpRight, Archive } from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import type { EmailTemplate } from "@/lib/campaign-templates";
import {
  lenderMergeFields,
  lenderTemplateSchema,
  renderLenderMessage,
  lenderTemplateValues,
  messagePreviewDocument,
  type LenderTemplate,
} from "@/lib/lender-templates";
import type { CampaignFormat } from "@/lib/campaign-content";
import { CampaignEditor } from "./campaign-editor";
import { Modal, t } from "./ui";
import { ProtectedForm, useUnsavedChanges } from "./unsaved-changes";
import "./mail-composer.css";

export type MailTemplateSource = Pick<
  LenderTemplate,
  "subject" | "body" | "body_format"
>;
export function useMailTemplates(
  demo: boolean,
  existing: EmailTemplate[] = [],
  refreshToken = 0,
) {
  const [templates, setTemplates] = useState<LenderTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<EmailTemplate[]>(existing);
  const [loading, setLoading] = useState(!demo),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/mail/templates", { signal: controller.signal })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        if (!controller.signal.aborted) {
          setTemplates(p.templates);
          setCampaigns(p.campaigns);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [demo, revision, refreshToken]);
  return {
    templates,
    campaigns,
    loading,
    error,
    reload: () => setRevision((n) => n + 1),
  };
}

export function MailTemplatePicker({
  data,
  locale,
  locked,
  onUse,
  onManage,
  onCreate,
  refreshToken = 0,
}: {
  data: Workspace;
  locale: Locale;
  locked: boolean;
  onUse: (p: MailTemplateSource) => void;
  onManage: () => void;
  onCreate?: () => void;
  refreshToken?: number;
}) {
  const library = useMailTemplates(
    !!data.demo,
    data.email_templates,
    refreshToken,
  );
  const [selection, setSelection] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <section className="mail-template-picker">
      <div className="mail-section-title">
        <FileText size={18} />
        <h3>{t(locale, "Plantilla del mensaje", "Message template")}</h3>
        <button
          type="button"
          className="text-button"
          disabled={locked}
          onClick={onManage}
        >
          {t(locale, "Gestionar plantillas", "Manage templates")}{" "}
          <ArrowUpRight size={14} />
        </button>
      </div>
      <label className="field">
        <span>
          {t(locale, "Usar una plantilla guardada", "Use a saved template")}
        </span>
        <select
          disabled={locked || library.loading}
          value={selection}
          onChange={(e) => {
            const id = e.target.value;
            setSelection(id);
            const item = id.startsWith("campaign:")
              ? library.campaigns.find((p) => "campaign:" + p.id === id)
              : library.templates.find((p) => p.id === id);
            if (item) {
              onUse({
                subject: item.subject,
                body: item.body,
                body_format: item.body_format || "plain",
              });
              setNotice(
                t(
                  locale,
                  "Plantilla aplicada. Revisa los datos y elige los documentos del expediente.",
                  "Template applied. Review the values and select this case's documents.",
                ),
              );
            }
          }}
        >
          <option value="">
            {library.loading
              ? t(locale, "Cargando plantillas…", "Loading templates…")
              : t(
                  locale,
                  "Escribir desde cero o elegir…",
                  "Write from scratch or choose…",
                )}
          </option>
          <optgroup
            label={t(locale, "Plantillas para lenders", "Lender templates")}
          >
            {library.templates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · v{p.version}
              </option>
            ))}
          </optgroup>
          <optgroup
            label={t(
              locale,
              "Campañas · copiar solo el mensaje inicial",
              "Campaigns · copy initial message only",
            )}
          >
            {library.campaigns
              .filter((p) => !p.archived_at)
              .map((p) => (
                <option key={p.id} value={"campaign:" + p.id}>
                  {p.name}
                </option>
              ))}
          </optgroup>
        </select>
      </label>
      {onCreate &&
        ["superadmin", "seller_admin"].includes(data.profile.role) && (
          <button
            type="button"
            className="text-button"
            disabled={locked}
            onClick={onCreate}
          >
            {t(
              locale,
              "Guardar este mensaje como plantilla",
              "Save this message as a template",
            )}
          </button>
        )}
      {notice && <small role="status">{notice}</small>}
      {library.error && (
        <p className="error-banner" role="alert">
          {library.error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={library.reload}
          >
            {t(locale, "Reintentar", "Retry")}
          </button>
        </p>
      )}
      {!library.loading &&
        !library.error &&
        !library.templates.length &&
        !library.campaigns.length && (
          <small>
            {t(
              locale,
              "Aún no hay plantillas. Créala en Gestionar plantillas o escribe el mensaje aquí.",
              "No templates yet. Open Manage templates or write your message here.",
            )}
          </small>
        )}
    </section>
  );
}

export function LenderTemplateLibrary({
  data,
  locale,
  initial,
  onUse,
}: {
  data: Workspace;
  locale: Locale;
  initial?: MailTemplateSource;
  onUse?: (p: MailTemplateSource) => void;
}) {
  const library = useMailTemplates(!!data.demo, data.email_templates);
  const [editing, setEditing] = useState<LenderTemplate | "new" | null>(null);
  const initialSource = useRef(initial);
  // Open after the containing library dialog mounts, so the form is above it
  // in the native dialog top layer and receives keyboard focus.
  useEffect(() => {
    if (initialSource.current) setEditing("new");
  }, []);
  const [archive, setArchive] = useState<LenderTemplate | null>(null);
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const allowed = ["superadmin", "seller_admin"].includes(data.profile.role);
  async function archiveTemplate(item: LenderTemplate) {
    setWorking(true);
    setError("");
    try {
      const r = await fetch("/api/mail/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...item,
          expected_version: item.version,
          archived: true,
          request_key: crypto.randomUUID(),
        }),
      });
      const p = await r.json();
      if (!r.ok) throw Error(p.error);
      setArchive(null);
      library.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="lender-template-library">
      <header className="mail-library-header">
        <div>
          <span className="mail-eyebrow">Pipeline OS</span>
          <h2>{t(locale, "Plantillas para lenders", "Lender templates")}</h2>
          <p>
            {t(
              locale,
              "Asunto y mensaje reutilizables. Los documentos se eligen en cada expediente.",
              "Reusable subjects and messages. Documents are selected in each case.",
            )}
          </p>
        </div>
        <div className="card-actions">
          <button
            className="button"
            type="button"
            aria-label={t(locale, "Actualizar plantillas", "Refresh templates")}
            onClick={library.reload}
          >
            <RefreshCw size={16} />
          </button>
          {allowed && (
            <button
              className="button primary"
              type="button"
              onClick={() => setEditing("new")}
            >
              <Plus size={16} />
              {t(locale, "Nueva plantilla", "New template")}
            </button>
          )}
        </div>
      </header>
      {!allowed && (
        <p className="muted">
          {t(
            locale,
            "Puedes usar las plantillas. Los administradores gestionan la biblioteca.",
            "You can use templates. Administrators manage the library.",
          )}
        </p>
      )}
      {(library.error || error) && (
        <p className="error-banner" role="alert">
          {library.error || error}
        </p>
      )}
      {library.loading ? (
        <p role="status">
          {t(locale, "Cargando biblioteca…", "Loading library…")}
        </p>
      ) : (
        <div className="mail-template-grid">
          {library.templates.map((item) => (
            <article className="mail-template-card" key={item.id}>
              <span className="mail-section-icon">
                <FileText size={20} />
              </span>
              <div>
                <h3>{item.name}</h3>
                <small>
                  v{item.version} ·{" "}
                  {item.body_format === "markdown"
                    ? t(locale, "Con formato", "Formatted")
                    : t(locale, "Texto", "Text")}
                </small>
                <p>{item.subject}</p>
                <p className="muted mail-template-excerpt">{item.body}</p>
              </div>
              <div className="card-actions">
                {onUse && (
                  <button
                    className="button primary"
                    onClick={() => onUse(item)}
                  >
                    {t(locale, "Usar plantilla", "Use template")}
                  </button>
                )}
                {allowed && (
                  <>
                    <button className="button" onClick={() => setEditing(item)}>
                      {t(locale, "Editar", "Edit")}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setArchive(item)}
                    >
                      <Archive size={14} />
                      {t(locale, "Archivar", "Archive")}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!library.loading && !library.error && !library.templates.length && (
        <div className="mail-library-empty">
          <FileText size={30} />
          <h3>
            {t(
              locale,
              "Tu próximo envío puede empezar aquí",
              "Your next email can start here",
            )}
          </h3>
          <p>
            {t(
              locale,
              "Crea una plantilla con variables como {{company}}, {{amount}} y {{lender_name}}.",
              "Create a template with fields such as {{company}}, {{amount}} and {{lender_name}}.",
            )}
          </p>
        </div>
      )}
      {library.campaigns.length > 0 && (
        <details className="mail-campaign-copies">
          <summary>
            {t(
              locale,
              "Reutilizar plantillas de campañas",
              "Reuse campaign templates",
            )}{" "}
            ({library.campaigns.length})
          </summary>
          <p>
            {t(
              locale,
              "Copia solo asunto y mensaje inicial. Los enlaces exclusivos de campaña deben editarse; no se copian archivos ni seguimientos.",
              "Copy only the subject and initial message. Edit campaign-specific links; attachments and follow-ups are not copied.",
            )}
          </p>
          {library.campaigns.map((p) => (
            <div className="mail-campaign-copy" key={p.id}>
              <strong>{p.name}</strong>
              {allowed && (
                <button
                  className="button"
                  onClick={() =>
                    setEditing({
                      id: crypto.randomUUID(),
                      name: p.name,
                      subject: p.subject,
                      body: p.body,
                      body_format: p.body_format || "plain",
                      version: 0,
                      archived_at: null,
                      updated_at: "",
                    })
                  }
                >
                  {t(locale, "Crear copia para lenders", "Create lender copy")}
                </button>
              )}
            </div>
          ))}
        </details>
      )}
      {editing && (
        <TemplateForm
          key={typeof editing === "string" ? "new" : editing.id}
          locale={locale}
          item={typeof editing === "string" ? undefined : editing}
          initial={typeof editing === "string" ? initial : undefined}
          demo={!!data.demo}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            library.reload();
          }}
        />
      )}
      {archive && (
        <Modal
          locale={locale}
          busy={working}
          title={t(locale, "Archivar plantilla", "Archive template")}
          close={() => setArchive(null)}
        >
          <p>{archive.name}</p>
          <p>
            {t(
              locale,
              "Las versiones guardadas se conservarán. Dejará de aparecer en los nuevos envíos.",
              "Saved versions will be retained. It will no longer appear for new emails.",
            )}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="modal-footer">
            <button
              className="button"
              disabled={working}
              onClick={() => setArchive(null)}
            >
              {t(locale, "Cancelar", "Cancel")}
            </button>
            <button
              className="button primary"
              disabled={working || !!data.demo}
              onClick={() => void archiveTemplate(archive)}
            >
              {t(locale, "Archivar", "Archive")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TemplateForm({
  locale,
  item,
  initial,
  demo,
  close,
  saved,
}: {
  locale: Locale;
  item?: LenderTemplate;
  initial?: MailTemplateSource;
  demo: boolean;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(item?.name || ""),
    [subject, setSubject] = useState(item?.subject || initial?.subject || ""),
    [body, setBody] = useState(item?.body || initial?.body || "");
  const [format, setFormat] = useState<CampaignFormat>(
    item?.body_format || initial?.body_format || "plain",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const id = useRef(item?.id || crypto.randomUUID()),
    request = useRef(crypto.randomUUID());
  const changes = useUnsavedChanges<HTMLFormElement>(
    { name, subject, body, format },
    busy,
  );
  const preview = renderLenderMessage(
    { subject, body, body_format: format },
    lenderTemplateValues(
      {
        contact: "Alex Example",
        company: "Example Business",
        email: "alex@example.test",
        phone: "+1 555 0100",
        industry: "Retail",
        amount: 50000,
        product: "Business loan",
      },
      "Example Lender",
    ),
  );
  return (
    <Modal
      locale={locale}
      className="mail-composer-modal"
      title={t(
        locale,
        item?.version ? "Editar plantilla" : "Nueva plantilla",
        item?.version ? "Edit template" : "New template",
      )}
      busy={busy}
      close={close}
    >
      <ProtectedForm
        busy={busy}
        changesRef={changes.ref}
        data-changes-explicit
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const p = lenderTemplateSchema.parse({
              id: id.current,
              expected_version: item?.version || 0,
              name,
              subject,
              body,
              body_format: format,
            });
            const r = await fetch("/api/mail/templates", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...p, request_key: request.current }),
            });
            const result = await r.json();
            if (!r.ok) throw Error(result.error);
            changes.markSaved();
            saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          {t(
            locale,
            "Guarda las variables, sin datos ni documentos de clientes. Esta vista usa un ejemplo ficticio.",
            "Save merge fields, without client data or documents. This preview uses fictional values.",
          )}
        </p>
        <div className="mail-composer-grid">
          <fieldset disabled={busy} className="mail-composer-fields">
            <label className="field">
              {t(locale, "Nombre de la plantilla", "Template name")}
              <input
                required
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              {t(locale, "Asunto", "Subject")}
              <input
                required
                value={subject}
                maxLength={200}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <CampaignEditor
              value={body}
              onChange={setBody}
              format={format}
              onFormat={setFormat}
              fields={lenderMergeFields}
              maxLength={10000}
              locale={locale}
            />
          </fieldset>
          <aside className="lender-mail-preview">
            <h3>{t(locale, "Ejemplo ficticio", "Fictional example")}</h3>
            <p>{preview.subject}</p>
            {preview.missing.length > 0 && (
              <p role="alert">
                {t(locale, "Revisa estas variables", "Review these fields")}:{" "}
                {preview.missing.join(", ")}
              </p>
            )}
            {preview.error ? (
              <p role="alert">{preview.error}</p>
            ) : (
              <iframe
                title={t(locale, "Ejemplo de plantilla", "Template example")}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={messagePreviewDocument(preview.html)}
              />
            )}
          </aside>
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button
            className="button primary"
            disabled={
              busy || demo || !!preview.error || preview.missing.length > 0
            }
          >
            {t(locale, "Guardar plantilla", "Save template")}
          </button>
        </div>
      </ProtectedForm>
    </Modal>
  );
}
