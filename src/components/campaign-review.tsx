"use client";
import { useEffect, useState } from "react";
import type { Campaign, Locale, Workspace } from "@/lib/domain";
import { renderTemplate } from "@/lib/domain";
import {
  audienceReasons,
  audienceValues,
  type CampaignAudience,
  type SendingBudget,
} from "@/lib/campaign-delivery";
import { renderCampaignContent } from "@/lib/campaign-content";
import type { Action } from "./crm";
import { t } from "./ui";
import { campaignPreviewValues } from "@/lib/campaign-templates";

export function SendingBudgets({
  data,
  locale,
}: {
  data: Workspace;
  locale: Locale;
}) {
  const [budgets, setBudgets] = useState<SendingBudget[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (data.demo) return;
    const abort = new AbortController();
    async function read() {
      try {
        const response = await fetch("/api/campaigns", {
          signal: abort.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setBudgets(result.budgets);
        setError("");
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    }
    void read();
    const timer = setInterval(() => {
      if (!document.hidden) void read();
    }, 60000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [data.demo, data.accounts]);
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <h2>
        {t(
          locale,
          "Cupos compartidos por cuenta · últimas 24 h",
          "Shared account budgets · last 24h",
        )}
      </h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data.demo && (
        <p>
          {t(
            locale,
            "Demostración: los cupos reales se consultan al conectar Gmail.",
            "Demo: actual budgets are available after connecting Gmail.",
          )}
        </p>
      )}
      <div className="campaign-grid">
        {budgets.map((b) => (
          <div key={b.account_id} className="analysis-card">
            <strong>
              {data.accounts.find((a) => a.id === b.account_id)?.email}
            </strong>
            <p>
              {b.total_messages}/{b.daily_limit}{" "}
              {t(
                locale,
                "mensajes · CRM + Gmail observado",
                "messages · CRM + observed Gmail",
              )}
            </p>
            <p>
              {t(
                locale,
                "Disponibles para campañas",
                "Available for campaigns",
              )}
              : <strong>{b.campaign_remaining}</strong> ·{" "}
              {t(locale, "Cupo compartido", "Shared limit")}: {b.campaign_limit}
            </p>
            <small>
              {t(locale, "Reserva operativa", "Operational reserve")}:{" "}
              {b.reserve} · {t(locale, "Fuera del CRM", "Outside CRM")}:{" "}
              {b.external_messages}
            </small>
            <p className="muted">
              {t(
                locale,
                "Destinatarios acumulados, incluidas copias",
                "Accumulated recipients, including copies",
              )}
              : {b.recipient_count}/{b.recipient_limit}
            </p>
            <p className="muted">
              {b.synced_at
                ? `${t(locale, "Gmail consultado", "Gmail checked")}: ${new Date(b.synced_at).toLocaleString()}`
                : t(
                    locale,
                    "Pendiente de consultar los envíos externos de Gmail.",
                    "External Gmail usage has not been checked yet.",
                  )}
            </p>
            {b.send_retry_at &&
              new Date(b.send_retry_at).getTime() > Date.now() && (
                <p>
                  {t(
                    locale,
                    "Pausada por Google hasta",
                    "Paused by Google until",
                  )}{" "}
                  {new Date(b.send_retry_at).toLocaleString()}
                </p>
              )}
          </div>
        ))}
      </div>
      <small>
        {t(
          locale,
          "Los envíos hechos fuera del CRM se incorporan periódicamente. Las campañas esperan si la consulta tiene más de 15 minutos. Google puede aplicar límites adicionales; el sistema respeta sus pausas.",
          "Email sent outside the CRM is incorporated periodically. Campaigns wait if the check is older than 15 minutes. Google may apply additional limits; its cooldowns are honored.",
        )}
      </small>
    </section>
  );
}

export function CampaignReview({
  campaign,
  data,
  locale,
  act,
  close,
}: {
  campaign: Campaign;
  data: Workspace;
  locale: Locale;
  act: Action;
  close: () => void;
}) {
  const canManage = ["superadmin", "seller_admin"].includes(data.profile.role);
  const [audience, setAudience] = useState<CampaignAudience[]>([]),
    [selected, setSelected] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [excluded, setExcluded] = useState<string[]>(
    campaign.excluded_contact_ids || [],
  );
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const [testKey, setTestKey] = useState(() => crypto.randomUUID());
  const [scheduledAt, setScheduledAt] = useState("");
  async function load() {
    if (!canManage) {
      setLoaded(true);
      return;
    }
    if (data.demo) {
      setAudience(
        data.opportunities.map((o) => ({
          contact_id: o.contact_id,
          opportunity_id: o.id,
          name: o.contact,
          email: o.email,
          company: o.company,
          amount: String(o.amount),
          industry: o.industry,
          phone: o.phone,
          reason:
            o.verification === "valid" &&
            !o.handed_off_at &&
            !["lost", "funded", "paused"].includes(o.stage)
              ? "eligible"
              : "unavailable",
          missing_fields: [],
        })),
      );
      setLoaded(true);
      return;
    }
    const response = await fetch(`/api/campaigns?campaign=${campaign.id}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setAudience(result.audience);
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [campaign.id]); // Audience is rechecked by the database on activation.
  const eligible = audience.filter(
    (c) => c.reason === "eligible" && !excluded.includes(c.contact_id),
  );
  const missing = audience.filter(
    (c) => c.reason === "missing_data" && !excluded.includes(c.contact_id),
  );
  const contact =
    audience.find((c) => c.contact_id === selected) || eligible[0];
  const dirty =
    JSON.stringify([...excluded].sort()) !==
    JSON.stringify([...(campaign.excluded_contact_ids || [])].sort());
  const filtered = audience.filter((c) =>
    `${c.name} ${c.company} ${c.email}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const editable = canManage && ["draft", "paused"].includes(campaign.status);
  let previewError = "";
  const messages: { subject: string; html: string }[] = [];
  if (contact)
    try {
      const vals = audienceValues(contact);
      for (const message of [campaign, ...campaign.steps])
        messages.push({
          subject: renderTemplate(message.subject, vals),
          html: renderCampaignContent(message.body, vals, campaign.body_format)
            .html,
        });
    } catch (e) {
      previewError = (e as Error).message;
    }
  if (!canManage)
    return (
      <section className="analysis-card">
        <h3>
          {t(
            locale,
            "Vista previa con datos de ejemplo",
            "Preview with sample data",
          )}
        </h3>
        {[campaign, ...campaign.steps].map((m, i) => {
          try {
            return (
              <div key={i}>
                <h4>{renderTemplate(m.subject, campaignPreviewValues)}</h4>
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderCampaignContent(
                      m.body,
                      campaignPreviewValues,
                      campaign.body_format,
                    ).html,
                  }}
                />
              </div>
            );
          } catch (e) {
            return (
              <p className="error" key={i}>
                {(e as Error).message}
              </p>
            );
          }
        })}
      </section>
    );
  return (
    <div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <p>
        <strong>{eligible.length}</strong>{" "}
        {t(locale, "disponibles", "eligible")} ·{" "}
        <strong>{missing.length}</strong>{" "}
        {t(locale, "con datos faltantes", "missing data")} ·{" "}
        {audience.length - eligible.length - missing.length}{" "}
        {t(locale, "excluidos", "excluded")}
      </p>
      <p>
        {data.accounts.find((a) => a.id === campaign.account_id)?.email} ·{" "}
        {campaign.timezone} · {campaign.start_hour}:00–{campaign.end_hour}:00 ·{" "}
        {campaign.daily_limit}/24 h
      </p>
      <label className="field">
        {t(locale, "Buscar destinatario", "Find recipient")}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      <div style={{ maxHeight: 280, overflow: "auto" }}>
        {filtered.slice(page * 100, page * 100 + 100).map((c) => (
          <div className="document-row" key={c.contact_id}>
            <label className="checkbox">
              <input
                type="checkbox"
                aria-label={`${t(locale, "Excluir", "Exclude")} ${c.email}`}
                disabled={!editable || busy}
                checked={excluded.includes(c.contact_id)}
                onChange={(e) =>
                  setExcluded((ids) =>
                    e.target.checked
                      ? [...ids, c.contact_id]
                      : ids.filter((id) => id !== c.contact_id),
                  )
                }
              />
              <span>
                {c.name || c.email} · {c.company}
                <small style={{ display: "block" }}>
                  {c.email} ·{" "}
                  {
                    (audienceReasons[
                      excluded.includes(c.contact_id) ? "excluded" : c.reason
                    ] || [c.reason, c.reason])[locale === "es" ? 0 : 1]
                  }{" "}
                  {c.missing_fields?.length
                    ? `(${c.missing_fields.join(", ")})`
                    : ""}
                </small>
              </span>
            </label>
            <button
              className="button"
              onClick={() => {
                setSelected(c.contact_id);
                setTestKey(crypto.randomUUID());
              }}
            >
              {t(locale, "Ver correo", "Preview email")}
            </button>
          </div>
        ))}
      </div>
      {filtered.length > 100 && (
        <div className="card-actions">
          <button
            className="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ←
          </button>
          <span>
            {page + 1}/{Math.ceil(filtered.length / 100)}
          </span>
          <button
            className="button"
            disabled={(page + 1) * 100 >= filtered.length}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </button>
        </div>
      )}
      {editable && (
        <button
          className="button"
          disabled={busy || !dirty}
          onClick={() =>
            void run(async () => {
              await act("campaign_audience_settings", {
                id: campaign.id,
                excluded_contact_ids: excluded,
              });
              await load();
            })
          }
        >
          {t(locale, "Guardar exclusiones", "Save exclusions")}
        </button>
      )}
      {contact && (
        <section className="analysis-card">
          <h3>
            {t(locale, "Vista previa para", "Preview for")}{" "}
            {contact.name || contact.email}
          </h3>
          <small>
            {t(
              locale,
              "Los enlaces de esta vista previa y de las pruebas son ilustrativos.",
              "Preview and test links are illustrative.",
            )}
          </small>
          {messages.map((m, i) => (
            <div key={i}>
              <h4>
                {i ? `${t(locale, "Seguimiento", "Follow-up")} ${i} · ` : ""}
                {m.subject}
              </h4>
              <div
                style={{ overflowWrap: "anywhere" }}
                dangerouslySetInnerHTML={{ __html: m.html }}
              />
            </div>
          ))}
          {previewError && <p className="error">{previewError}</p>}
          <p>{campaign.asset_snapshot?.map((a) => a.name).join(" · ")}</p>
          <button
            className="button"
            disabled={
              busy ||
              dirty ||
              data.demo ||
              !!previewError ||
              contact.reason !== "eligible" ||
              excluded.includes(contact.contact_id)
            }
            onClick={() =>
              void run(async () => {
                const response = await fetch("/api/campaigns", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    campaign_id: campaign.id,
                    contact_id: contact.contact_id,
                    request_key: testKey,
                  }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                setNotice(
                  `${t(locale, "Prueba en cola para", "Test queued for")} ${result.recipient}`,
                );
                setTestKey(crypto.randomUUID());
              })
            }
          >
            {t(locale, "Enviar prueba a mi correo", "Send test to my email")}
          </button>
        </section>
      )}
      {missing.length > 0 && (
        <p className="error">
          {t(
            locale,
            "Corrige los datos faltantes o excluye explícitamente esos contactos antes de activar.",
            "Correct missing data or explicitly exclude those contacts before activation.",
          )}
        </p>
      )}
      {editable && (
        <p className="campaign-note">
          {t(
            locale,
            "Activar o programar autoriza al worker a enviar correos reales a los leads elegibles revisados, respetando las cuotas y el horario.",
            "Activating or scheduling authorizes the worker to send real email to reviewed eligible leads, within quotas and sending hours.",
          )}
        </p>
      )}
      {editable && campaign.first_contact && (
        <div className="form-grid">
          <label className="field">
            {t(
              locale,
              "Fecha y hora local (opcional)",
              "Local date and time (optional)",
            )}
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
            <small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
          </label>
          <button
            className="button"
            disabled={
              busy ||
              dirty ||
              !loaded ||
              !eligible.length ||
              !!missing.length ||
              !scheduledAt ||
              data.demo
            }
            onClick={() =>
              void run(async () => {
                await act("schedule_campaign", {
                  id: campaign.id,
                  scheduled_at: new Date(scheduledAt).toISOString(),
                });
                close();
              })
            }
          >
            {t(
              locale,
              "Programar campaña revisada",
              "Schedule reviewed campaign",
            )}
          </button>
        </div>
      )}
      {editable && (
        <button
          className="button primary"
          disabled={
            busy ||
            dirty ||
            !loaded ||
            !eligible.length ||
            !!missing.length ||
            data.demo
          }
          onClick={() =>
            void run(async () => {
              await act("activate_campaign", { id: campaign.id });
              close();
            })
          }
        >
          {t(locale, "Activar campaña revisada", "Activate reviewed campaign")}
        </button>
      )}
    </div>
  );
}
