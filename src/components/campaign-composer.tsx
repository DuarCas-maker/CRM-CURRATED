"use client";
import { useEffect, useState } from "react";
import type { Workspace, Locale } from "@/lib/domain";
import type { EmailTemplate } from "@/lib/campaign-templates";
import { campaignPreviewValues } from "@/lib/campaign-templates";
import {
  audienceReasons,
  type CampaignAudience,
} from "@/lib/campaign-delivery";
import { renderCampaignContent } from "@/lib/campaign-content";
import type { Action } from "./crm";
import { Field, t } from "./ui";

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
  const accounts = data.accounts.filter(
    (a) =>
      a.status === "connected" &&
      (data.demo ||
        data.profile.role === "superadmin" ||
        data.sender_account_ids?.includes(a.id)),
  );
  const [templateId, setTemplateId] = useState(
    initialTemplate?.id || templates[0]?.id || "",
  );
  const [account, setAccount] = useState(accounts[0]?.id || "");
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
  const template = templates.find((t) => t.id === templateId);
  useEffect(() => {
    setLeads(null);
    setError("");
    if (data.demo || !templateId || !account) return;
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      void fetch(
        "/api/campaigns/center?" +
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
  }, [data.demo, templateId, account, query, page]);
  let preview = "";
  try {
    if (template)
      preview = renderCampaignContent(
        template.body,
        campaignPreviewValues,
        template.body_format,
      ).html;
  } catch {}
  const selected = manual ? ids.length : Math.min(leads?.eligible || 0, 5000);
  async function submit(form: HTMLFormElement, intent: string) {
    if (!template || data.demo) return;
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(new FormData(form));
      let id = saved;
      if (!id) {
        const result = (await act("create_campaign", {
          ...fields,
          account_id: account,
          template_id: template.id,
          template_version: template.version,
          subject: template.subject,
          body: template.body,
          steps: [],
          body_format: template.body_format || "plain",
          ...(manual ? { selected_contact_ids: ids } : {}),
        })) as { id: string };
        id = result.id;
        setSaved(id);
      }
      if (intent === "schedule")
        await act("schedule_campaign", {
          id,
          scheduled_at: new Date(scheduled).toISOString(),
        });
      if (intent === "activate") await act("activate_campaign", { id });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="campaign-composer"
      onSubmit={(e) => {
        e.preventDefault();
        const intent =
          (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ||
          "draft";
        if (intent === "review") {
          setReview(true);
          return;
        }
        void submit(e.currentTarget, intent);
      }}
    >
      <p className="muted">
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
      {!accounts.length && (
        <p className="campaign-note">
          {t(
            locale,
            "Conecta una cuenta Gmail y autoriza al remitente desde Configuración antes de crear campañas.",
            "Connect a Gmail account and authorize the sender in Settings before creating campaigns.",
          )}
        </p>
      )}
      <fieldset disabled={busy || !!saved} style={{ border: 0, padding: 0 }}>
        <Field
          name="name"
          label={t(locale, "Nombre de campaña", "Campaign name")}
          required
        />
        <div className="form-grid">
          <label className="field">
            {t(locale, "Plantilla del primer correo", "Initial email template")}
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
              "Límite de envío por 24 h",
              "Sending limit per 24h",
            )}
            type="number"
            value={100}
            min={1}
            max={2000}
            required
          />
        </div>
        <section className="campaign-note" aria-live="polite">
          <strong>
            {t(locale, "Leads de Preparación", "Leads from Preparation")}
          </strong>
          <p>
            {loading
              ? t(locale, "Consultando elegibilidad…", "Checking eligibility…")
              : `${leads?.eligible ?? "—"} ${t(locale, "elegibles", "eligible")} · ${leads?.excluded ?? "—"} ${t(locale, "excluidos", "excluded")}`}
          </p>
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
          <p>
            <strong>{selected}</strong>{" "}
            {t(locale, "leads seleccionados", "selected leads")}
          </p>
        </section>
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
            {t(locale, "Horario permitido de envío", "Permitted sending hours")}
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
      </fieldset>
      {template && (
        <details open={review}>
          <summary>
            {t(
              locale,
              "Vista previa del correo inicial",
              "Initial email preview",
            )}{" "}
            · v{template.version}
          </summary>
          <div className="analysis-card">
            <h3>{template.subject}</h3>
            <div dangerouslySetInnerHTML={{ __html: preview }} />
            <small>
              {t(
                locale,
                "Ejemplo con variables ilustrativas. Los adjuntos y esta versión quedan guardados en la campaña.",
                "Preview with sample values. Attachments and this version are frozen with the campaign.",
              )}
            </small>
          </div>
        </details>
      )}
      {review && (
        <p className="campaign-note">
          {t(
            locale,
            "Al activar autorizas el envío real a los leads seleccionados, sujeto a revalidación, horario y cuotas de Gmail. Solo se enviará el correo inicial.",
            "Activation authorizes real sending to selected leads, subject to revalidation, schedule and Gmail quotas. Only the initial email will be sent.",
          )}
        </p>
      )}
      <div className="card-actions" style={{ marginTop: 18 }}>
        <button
          className="button"
          value="draft"
          disabled={busy || !template || !account || data.demo}
        >
          {t(locale, "Guardar borrador", "Save draft")}
        </button>
        <button
          className="button"
          value="schedule"
          disabled={
            busy || !scheduled || !selected || loading || !leads || data.demo
          }
        >
          {t(locale, "Programar campaña", "Schedule campaign")}
        </button>
        <button
          className="button primary"
          value={review ? "activate" : "review"}
          disabled={busy || !selected || loading || !leads || data.demo}
        >
          {review
            ? t(locale, "Confirmar y activar", "Confirm and activate")
            : t(
                locale,
                "Revisar y activar campaña",
                "Review and activate campaign",
              )}
        </button>
      </div>
    </form>
  );
}
