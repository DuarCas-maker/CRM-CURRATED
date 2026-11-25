"use client";
import { useEffect, useRef, useState } from "react";
import { importCampaignHref } from "@/lib/campaign-import";
import { campaignControlAction } from "@/lib/campaign-control-client";
import { markFormSaved, useNativeChanges } from "./unsaved-changes";
import { renderTemplate, type Workspace, type Locale } from "@/lib/domain";
import type { EmailTemplate } from "@/lib/campaign-templates";
import { templatePreviewValues } from "@/lib/campaign-templates";
import {
  audienceReasons,
  type CampaignAudience,
} from "@/lib/campaign-delivery";
import { renderCampaignContent } from "@/lib/campaign-content";
import type { Action } from "./crm";
import { Field, t } from "./ui";
import {
  accountPreparation,
  sameBrandPreparation,
  type BrandPreparation,
} from "@/lib/brand-delivery";

interface LeadsPage {
  eligible: number;
  excluded: number;
  reasons: Record<string, number>;
  total: number;
  rows: CampaignAudience[];
}
export function CampaignComposer({
  data,
  locale,
  initialTemplate,
  act,
  close,
  sourceBatchId,
  presentation = "classic",
  onReviewImport,
}: {
  data: Workspace;
  locale: Locale;
  initialTemplate: EmailTemplate | null;
  act: Action;
  close: () => void;
  sourceBatchId?: string;
  presentation?: "classic" | "pipeline";
  onReviewImport?: () => void;
}) {
  const studio = presentation === "pipeline";
  const Advanced = studio ? "details" : "div";
  const Preview = studio ? "section" : "details";
  const templates = [
    ...(initialTemplate ? [initialTemplate] : []),
    ...(data.email_templates || []).filter((t) => t.id !== initialTemplate?.id),
  ].filter((t) => !t.archived_at);
  const accounts = data.accounts.filter(
    (a) =>
      a.status === "connected" &&
      !!a.brand_context?.can_campaign &&
      (data.demo ||
        data.profile.role === "superadmin" ||
        data.sender_account_ids?.includes(a.id)),
  );
  const [templateId, setTemplateId] = useState(
    initialTemplate?.id || templates[0]?.id || "",
  );
  const [account, setAccount] = useState(accounts[0]?.id || "");
  const [extraSenders, setExtraSenders] = useState<string[]>([]);
  const [senderLimits, setSenderLimits] = useState<Record<string, number>>({});
  const senderIds = [
    account,
    ...extraSenders.filter(
      (id) =>
        id !== account &&
        accounts.some(
          (a) =>
            a.id === id &&
            a.brand_context?.brand_id ===
              accounts.find((a) => a.id === account)?.brand_context?.brand_id,
        ),
    ),
  ].filter(Boolean);
  const senderSettings = senderIds.map((id) => ({
    account_id: id,
    daily_limit: senderLimits[id] ?? 100,
    brand_preparation: accountPreparation(accounts.find((a) => a.id === id)),
  }));
  const [brandPreparation, setBrandPreparation] =
    useState<BrandPreparation | null>(null);
  const expectedBrand = accountPreparation(
    accounts.find((a) => a.id === account),
  );
  const brandCurrent = sameBrandPreparation(expectedBrand, brandPreparation);
  const [manual, setManual] = useState(false),
    [ids, setIds] = useState<string[]>([]);
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const [leads, setLeads] = useState<LeadsPage | null>(null),
    [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [scheduled, setScheduled] = useState("");
  const [review, setReview] = useState(false),
    [saved, setSaved] = useState<string | null>(null);
  const [reviewLimit, setReviewLimit] = useState(100);
  const formRef = useRef<HTMLFormElement>(null);
  const leaving = useRef(false);
  const importKeys = useRef(new Map<string, string>());
  useNativeChanges(formRef, true, false, () => busy && !leaving.current);
  const template = templates.find((t) => t.id === templateId);
  useEffect(() => {
    setLeads(null);
    setError("");
    if (data.demo || !templateId || !account) return;
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void fetch(
        sourceBatchId
          ? importCampaignHref(sourceBatchId, templateId, account, query, page)
          : "/api/campaigns/center?" +
              new URLSearchParams({
                mode: "leads",
                template: templateId,
                account,
                search: query,
                page: String(page),
              }),
        { signal: abort.signal },
      )
        .then(async (r) => {
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          setLeads(result);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [data.demo, templateId, account, query, page, sourceBatchId]);
  let preview = "";
  let previewSubject = "";
  let previewError = false;
  try {
    if (template) {
      const previewValues = templatePreviewValues(template.funding_model, data.accounts.find((a) => a.id === account)?.email);
      previewSubject = renderTemplate(template.subject, previewValues);
      preview = renderCampaignContent(
        template.body,
        previewValues,
        template.body_format,
      ).html;
    }
  } catch {
    previewError = true;
  }
  const selected = manual
    ? ids.length
    : sourceBatchId
      ? leads?.eligible || 0
      : Math.min(leads?.eligible || 0, 5000);
  async function submit(form: HTMLFormElement, intent: string) {
    if (!template || !brandCurrent || data.demo || (studio && previewError))
      return;
    leaving.current = false;
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(new FormData(form));
      let id = saved;
      if (!id) {
        const payload = {
          ...fields,
          account_id: account,
          brand_preparation: brandPreparation,
          template_id: template.id,
          template_version: template.version,
          subject: template.subject,
          body: template.body,
          steps: [],
          body_format: template.body_format || "plain",
          ...(manual ? { selected_contact_ids: ids } : {}),
        };
        let result: { id: string };
        if (sourceBatchId && studio) {
          result = await campaignControlAction(
            "create",
            {
              ...payload,
              import_batch_id: sourceBatchId,
              senders: senderSettings,
            },
            importKeys.current,
          );
        } else if (sourceBatchId) {
          const scoped = { ...payload, import_batch_id: sourceBatchId };
          const fingerprint = JSON.stringify(scoped);
          let request_key = importKeys.current.get(fingerprint);
          if (!request_key) {
            request_key = crypto.randomUUID();
            importKeys.current.set(fingerprint, request_key);
          }
          const response = await fetch("/api/campaigns/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "create",
              request_key,
              payload: scoped,
            }),
          });
          result = await response.json();
          if (!response.ok)
            throw new Error((result as unknown as { error: string }).error);
        } else
          result = (await act("create_campaign", payload)) as { id: string };
        id = result.id;
        setSaved(id);
      }
      if (
        studio &&
        sourceBatchId &&
        (intent === "schedule" || intent === "activate")
      )
        await campaignControlAction(
          intent,
          {
            id,
            senders: senderSettings,
            ...(intent === "schedule"
              ? { scheduled_at: new Date(scheduled).toISOString() }
              : {}),
          },
          importKeys.current,
        );
      else if (intent === "schedule")
        await act("schedule_campaign", {
          id,
          scheduled_at: new Date(scheduled).toISOString(),
          brand_preparation: brandPreparation,
        });
      if (!(studio && sourceBatchId) && intent === "activate")
        await act("activate_campaign", {
          id,
          brand_preparation: brandPreparation,
        });
      markFormSaved(form);
      leaving.current = true;
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const ownerFields = (
    <>
      <Field
        name="seller_id"
        label={t(locale, "Responsable", "Owner")}
        required
        value={data.profile.id}
      >
        {data.profiles
          .filter(
            (p) =>
              p.active !== false &&
              ["superadmin", "seller_admin", "seller"].includes(p.role),
          )
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Field>
      <Field
        name="daily_limit"
        label={t(
          locale,
          studio
            ? "Máximo total de campaña por 24 h"
            : "Límite de envío por 24 h",
          studio ? "Total campaign limit per 24h" : "Sending limit per 24h",
        )}
        type="number"
        value={100}
        min={1}
        max={2000}
        required
      />
    </>
  );
  const brandField = (
    <label className="field">
      {t(locale, "Marca de la campaña", "Campaign brand")}
      <select
        required
        value={brandCurrent ? brandPreparation?.brand_id || "" : ""}
        onChange={(e) =>
          setBrandPreparation(e.target.value ? expectedBrand : null)
        }
      >
        <option value="">
          {t(
            locale,
            "Revisa y selecciona la marca",
            "Review and select the brand",
          )}
        </option>
        {expectedBrand && (
          <option value={expectedBrand.brand_id}>
            {accounts.find((a) => a.id === account)?.brand_context?.brand_name}
          </option>
        )}
      </select>
    </label>
  );
  return (
    <form
      ref={formRef}
      aria-busy={busy}
      className={studio ? "campaign-composer cs-studio" : "campaign-composer"}
      onChange={studio ? () => setReview(false) : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const intent =
          (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ||
          "draft";
        if (intent === "review") {
          setReviewLimit(Number(new FormData(e.currentTarget).get('daily_limit')));
          setReview(true);
          return;
        }
        void submit(e.currentTarget, intent);
      }}
    >
      <p className={studio ? "cs-intro" : "muted"}>
        {t(
          locale,
          "Solo el primer correo, a leads validados de Preparación de leads.",
          "Only the initial email, to validated leads from Lead preparation.",
        )}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
          {saved &&
            " · " +
              t(
                locale,
                "El borrador está guardado; puedes reintentar la activación.",
                "The draft is saved; you can retry activation.",
              )}
        </p>
      )}
      {data.demo && (
        <p className="campaign-note">
          {t(
            locale,
            "Vista de demostración. La selección real se consulta al iniciar sesión en el CRM.",
            "Demo view. Sign in to the CRM to load actual eligible leads.",
          )}
        </p>
      )}
      {!templates.length && (
        <p className="campaign-note">
          {t(
            locale,
            "Crea una plantilla en la pestaña Plantillas para preparar tu primer correo.",
            "Create a template in the Templates tab to prepare your first email.",
          )}
        </p>
      )}

      {!studio && brandField}
      {!accounts.length && (
        <p className="campaign-note">
          {t(
            locale,
            "Conecta una cuenta Gmail y autoriza al remitente desde Configuración antes de crear campañas.",
            "Connect a Gmail account and authorize the sender in Settings before creating campaigns.",
          )}
        </p>
      )}
      <fieldset
        disabled={busy || !!saved}
        className={studio ? "cs-fields" : undefined}
        style={{ border: 0, padding: 0 }}
      >
        <section className={studio ? "cs-config cs-surface" : undefined}>
          {studio && (
            <div className="cs-section-heading">
              <span className="cs-kicker">
                {t(locale, "CONFIGURACIÓN", "SETUP")}
              </span>
              <h3>
                {t(locale, "Prepara tu campaña", "Prepare your campaign")}
              </h3>
              <p>
                {t(
                  locale,
                  "Elige qué enviar y desde qué cuenta.",
                  "Choose what to send and which account to use.",
                )}
              </p>
            </div>
          )}
          <Field
            name="name"
            label={t(locale, "Nombre de campaña", "Campaign name")}
            required
          />
          <div className="form-grid">
            <label className="field">
              {t(
                locale,
                "Plantilla del primer correo",
                "Initial email template",
              )}
              <select
                required
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setIds([]);
                  setPage(0);
                  setReview(false);
                }}
              >
                <option value="">
                  {t(locale, "Selecciona una plantilla", "Choose a template")}
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · v{t.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t(
                locale,
                "Cuenta remitente autorizada",
                "Authorized sender account",
              )}
              <select
                required
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  setExtraSenders([]);
                  setBrandPreparation(null);
                  setIds([]);
                  setPage(0);
                  setReview(false);
                }}
              >
                <option value="">
                  {t(locale, "Selecciona una cuenta", "Choose an account")}
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </label>
            {!studio && ownerFields}
          </div>
          {studio && brandField}
          {studio && sourceBatchId && (
            <section
              className="cs-senders"
              aria-label={t(
                locale,
                "Remitentes de la campaña",
                "Campaign senders",
              )}
            >
              <strong>
                {t(
                  locale,
                  "Repartir contactos entre remitentes",
                  "Distribute contacts across senders",
                )}
              </strong>
              <p>
                {t(
                  locale,
                  "Una asignación por contacto, dentro de la misma marca. Si una cuenta no tiene cupo, sus contactos esperan.",
                  "One sender per contact within the same brand. Contacts wait if their sender has no capacity.",
                )}
              </p>
              {accounts
                .filter(
                  (a) =>
                    a.id === account ||
                    a.brand_context?.brand_id === expectedBrand?.brand_id,
                )
                .map((a) => (
                  <div className="cs-sender-row" key={a.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={senderIds.includes(a.id)}
                        disabled={a.id === account}
                        onChange={(e) =>
                          setExtraSenders((ids) =>
                            e.target.checked
                              ? [...ids, a.id]
                              : ids.filter((id) => id !== a.id),
                          )
                        }
                      />
                      <span>
                        {a.email}
                        {a.id === account && (
                          <small>
                            {t(locale, "Cuenta principal", "Primary account")}
                          </small>
                        )}
                      </span>
                    </label>
                    {senderIds.includes(a.id) && (
                      <label className="cs-sender-limit">
                        {t(locale, "Máximo /24h", "Limit /24h")}
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          required
                          aria-label={t(
                            locale,
                            `Límite de ${a.email}`,
                            `Limit for ${a.email}`,
                          )}
                          value={senderLimits[a.id] ?? 100}
                          onChange={(e) =>
                            setSenderLimits((x) => ({
                              ...x,
                              [a.id]: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                  </div>
                ))}
              <small>
                {t(
                  locale,
                  `${senderIds.length} remitentes · reparto aproximado de ${Math.floor(selected / Math.max(1, senderIds.length))}–${Math.ceil(selected / Math.max(1, senderIds.length))} contactos por cuenta. El cupo real de Gmail y el máximo total también se respetan.`,
                  `${senderIds.length} senders · approximately ${Math.floor(selected / Math.max(1, senderIds.length))}–${Math.ceil(selected / Math.max(1, senderIds.length))} contacts per account. Actual Gmail capacity and the total campaign limit still apply.`,
                )}
              </small>
            </section>
          )}
        </section>
        <section
          className={studio ? "cs-audience cs-surface" : "campaign-note"}
          aria-live="polite"
        >
          <strong>
            {sourceBatchId
              ? t(
                  locale,
                  "Destinatarios de este archivo",
                  "Recipients from this file",
                )
              : t(locale, "Leads de Preparación", "Leads from Preparation")}
          </strong>
          {sourceBatchId && !studio && (
            <p>
              {t(
                locale,
                "Solo se incluirán contactos elegibles de este lote. Máximo 5.000 por campaña; los lotes mayores requieren selección explícita.",
                "Only eligible contacts from this import are included. Maximum 5,000 per campaign; larger imports require an explicit selection.",
              )}
            </p>
          )}
          <p>
            {loading
              ? t(locale, "Consultando elegibilidad…", "Checking eligibility…")
              : `${leads?.eligible ?? "—"} ${t(locale, "elegibles", "eligible")} · ${leads?.excluded ?? "—"} ${t(locale, "excluidos", "excluded")}`}
          </p>
          {studio && (
            <p className="cs-audience-explainer">
              {t(
                locale,
                "Solo se enviará a contactos válidos y elegibles de este archivo. Los demás permanecen excluidos.",
                "Only valid, eligible contacts from this file will receive the email. All others remain excluded.",
              )}
            </p>
          )}
          {studio && onReviewImport && (
            <button
              type="button"
              className="pos-btn cs-link"
              onClick={onReviewImport}
            >
              {t(
                locale,
                "Ver contactos y motivos de exclusión",
                "View contacts and exclusion reasons",
              )}{" "}
              →
            </button>
          )}
          <details
            className={studio ? "cs-selection" : undefined}
            open={studio ? undefined : true}
          >
            <summary hidden={!studio}>
              {t(
                locale,
                "Ajustar selección de destinatarios",
                "Adjust recipient selection",
              )}
            </summary>
            {leads && (
              <div className="campaign-reasons">
                {Object.entries(leads.reasons)
                  .filter(([k]) => k !== "eligible")
                  .map(([k, n]) => (
                    <span key={k}>
                      {(audienceReasons[k] || [k, k])[locale === "es" ? 0 : 1]}:{" "}
                      {n}
                    </span>
                  ))}
              </div>
            )}
            <div className="card-actions">
              <label>
                <input
                  type="radio"
                  name="selectionMode"
                  checked={!manual}
                  onChange={() => {
                    setManual(false);
                    setReview(false);
                  }}
                />{" "}
                {t(locale, "Selección automática", "Automatic selection")}
              </label>
              <label>
                <input
                  type="radio"
                  name="selectionMode"
                  checked={manual}
                  onChange={() => {
                    setManual(true);
                    setReview(false);
                  }}
                />{" "}
                {t(locale, "Elegir algunos leads", "Choose some leads")}
              </label>
            </div>
            <small>
              {t(
                locale,
                "Máximo 5.000 leads por campaña. La selección se guarda al crear el borrador y se revalida al activar y enviar.",
                "Up to 5,000 leads per campaign. Selection is saved with the draft and rechecked at activation and delivery.",
              )}
            </small>
            {manual && (
              <>
                <input
                  aria-label={t(locale, "Buscar lead", "Search leads")}
                  placeholder={t(
                    locale,
                    "Buscar empresa, contacto o correo",
                    "Search company, contact or email",
                  )}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
                <div className="campaign-lead-picker">
                  {leads?.rows.map((l) => (
                    <label key={l.contact_id}>
                      <input
                        type="checkbox"
                        disabled={
                          l.reason !== "eligible" ||
                          (!ids.includes(l.contact_id) && ids.length >= 5000)
                        }
                        checked={ids.includes(l.contact_id)}
                        onChange={(e) => {
                          setIds((x) =>
                            e.target.checked
                              ? [...x, l.contact_id]
                              : x.filter((id) => id !== l.contact_id),
                          );
                          setReview(false);
                        }}
                      />
                      <span>
                        <strong>{l.company}</strong> · {l.name}
                        <small>
                          {l.email} ·{" "}
                          {
                            (audienceReasons[l.reason] || [l.reason, l.reason])[
                              locale === "es" ? 0 : 1
                            ]
                          }
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="card-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ←
                  </button>
                  <span>
                    {page + 1} /{" "}
                    {Math.max(1, Math.ceil((leads?.total || 0) / 50))}
                  </span>
                  <button
                    type="button"
                    className="button"
                    disabled={(page + 1) * 50 >= (leads?.total || 0)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    →
                  </button>
                </div>
              </>
            )}
          </details>
          <p className={studio ? "cs-selected" : undefined}>
            <strong>{selected}</strong>{" "}
            {t(locale, "leads seleccionados", "selected leads")}
          </p>
        </section>
        <Advanced className={studio ? "cs-advanced cs-surface" : undefined}>
          {studio && (
            <summary>
              <strong>
                {t(locale, "Opciones de envío", "Sending options")}
              </strong>
              <span>
                {t(
                  locale,
                  "Responsable, límite diario y programación",
                  "Owner, daily limit and scheduling",
                )}
              </span>
            </summary>
          )}
          {studio && <div className="form-grid">{ownerFields}</div>}
          <div className="form-grid">
            <label className="field">
              {t(
                locale,
                "Programar fecha y hora (opcional, hora local)",
                "Schedule date and time (optional, local time)",
              )}
              <input
                type="datetime-local"
                value={scheduled}
                onChange={(e) => setScheduled(e.target.value)}
              />
              <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
            </label>
            <Field
              name="timezone"
              label={t(locale, "Zona horaria del envío", "Sending timezone")}
              value="America/Bogota"
            >
              {[
                "America/Bogota",
                "America/New_York",
                "America/Chicago",
                "America/Denver",
                "America/Los_Angeles",
                "UTC",
              ].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Field>
          </div>
          <details>
            <summary>
              {t(
                locale,
                "Horario permitido de envío",
                "Permitted sending hours",
              )}
            </summary>
            <div className="form-grid">
              <Field
                name="start_hour"
                label={t(locale, "Hora inicial", "Start hour")}
                type="number"
                value={9}
                min={0}
                max={23}
                required
              />
              <Field
                name="end_hour"
                label={t(locale, "Hora final", "End hour")}
                type="number"
                value={17}
                min={1}
                max={24}
                required
              />
            </div>
          </details>
        </Advanced>
      </fieldset>
      {template && (
        <Preview
          {...(!studio ? { open: review } : {})}
          className={studio ? "cs-preview cs-surface" : undefined}
        >
          {studio && (
            <div className="cs-preview-label">
              <span>{t(locale, "VISTA PREVIA", "EMAIL PREVIEW")}</span>
              <span className="cs-badge">
                {t(locale, "Datos de ejemplo", "Sample data")}
              </span>
            </div>
          )}
          {studio ? (
            <div className="cs-mail-meta">
              <span>
                {t(locale, "De", "From")}:{" "}
                {accounts.find((a) => a.id === account)?.email || "—"}
              </span>
              <span>{t(locale, "Para", "To")}: Alex · Example Business</span>
              <strong>{previewSubject}</strong>
            </div>
          ) : (
            <summary>
              {t(
                locale,
                "Vista previa del correo inicial",
                "Initial email preview",
              )}{" "}
              · v{template.version}
            </summary>
          )}
          <div className={studio ? "cs-mail-body" : "analysis-card"}>
            {studio && previewError && (
              <p role="alert">
                {t(
                  locale,
                  "No se pudo representar esta plantilla. Revisa sus variables en Plantillas o elige otra antes de continuar.",
                  "This template could not be rendered. Check its variables in Templates or choose another before continuing.",
                )}
              </p>
            )}
            {!studio && <h3>{template.subject}</h3>}
            <div
              onClick={
                studio
                  ? (e) => {
                      if ((e.target as HTMLElement).closest("a"))
                        e.preventDefault();
                    }
                  : undefined
              }
              dangerouslySetInnerHTML={{ __html: preview }}
            />
            <small>
              {t(
                locale,
                "Ejemplo con variables ilustrativas. Los adjuntos y esta versión quedan guardados en la campaña.",
                "Preview with sample values. Attachments and this version are frozen with the campaign.",
              )}
            </small>
          </div>
          {studio && (
            <div className="cs-preview-version">
              {template.name} · v{template.version}
              {template.asset_ids.length > 0 &&
                ` · ${template.asset_ids.length} ${t(locale, "adjuntos", "attachments")}`}
            </div>
          )}
        </Preview>
      )}
      {review && (
        <p className="campaign-note">
          {t(
            locale,
            studio
              ? `Revisa: ${selected} destinatarios, ${sourceBatchId ? `${senderIds.length} remitentes seleccionados` : accounts.find((a) => a.id === account)?.email || "—"}, máximo total ${reviewLimit}/24 h y plantilla v${template?.version}. Al confirmar ${scheduled ? "programarás" : "activarás"} el envío real del correo inicial, sujeto a validación, horario y límites de cada cuenta.`
              : "Al activar autorizas el envío real a los leads seleccionados, sujeto a revalidación, horario y cuotas de Gmail. Solo se enviará el correo inicial.",
            studio
              ? `Review: ${selected} recipients, ${sourceBatchId ? senderIds.length : 1} selected senders, total limit ${reviewLimit}/24h and template v${template?.version}. Confirming authorizes the initial email, subject to validation, hours and each account's limits.`
              : "Activation authorizes real sending to selected leads, subject to revalidation, schedule and Gmail quotas. Only the initial email will be sent.",
          )}
        </p>
      )}
      {sourceBatchId && selected > 5000 && (
        <p role="alert" className="error">
          {t(
            locale,
            "Selecciona hasta 5.000 destinatarios. No se recortará el archivo automáticamente.",
            "Select up to 5,000 recipients. The file will not be truncated automatically.",
          )}
        </p>
      )}
      <div
        className={studio ? "cs-actions" : "card-actions"}
        style={studio ? undefined : { marginTop: 18 }}
      >
        {studio && (
          <span>
            {t(
              locale,
              `${selected} destinatarios · activación manual`,
              `${selected} recipients · manual activation`,
            )}
          </span>
        )}
        <button
          className="button"
          value="draft"
          disabled={
            busy ||
            (studio && previewError) ||
            !template ||
            !account ||
            !brandCurrent ||
            data.demo ||
            (Boolean(sourceBatchId) && selected > 5000)
          }
        >
          {t(locale, "Guardar borrador", "Save draft")}
        </button>
        {!studio && (
          <button
            className="button"
            value="schedule"
            disabled={
              busy ||
              !scheduled ||
              !selected ||
              loading ||
              !leads ||
              data.demo ||
              (Boolean(sourceBatchId) && selected > 5000)
            }
          >
            {t(locale, "Programar campaña", "Schedule campaign")}
          </button>
        )}
        <button
          className="button primary"
          value={
            review ? (studio && scheduled ? "schedule" : "activate") : "review"
          }
          disabled={
            busy ||
            (studio && previewError) ||
            !selected ||
            loading ||
            !leads ||
            data.demo ||
            (Boolean(sourceBatchId) && selected > 5000)
          }
        >
          {review
            ? studio && scheduled
              ? t(locale, "Confirmar y programar", "Confirm and schedule")
              : t(locale, "Confirmar y activar", "Confirm and activate")
            : t(
                locale,
                studio ? "Revisar campaña" : "Revisar y activar campaña",
                studio ? "Review campaign" : "Review and activate campaign",
              )}
        </button>
      </div>
    </form>
  );
}
