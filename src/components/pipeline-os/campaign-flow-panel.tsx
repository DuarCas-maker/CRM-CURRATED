"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  Mail,
  RefreshCw,
  Upload,
} from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import { type FlowPool } from "@/lib/campaign-flow";
import type { ControlOverview } from "@/lib/campaign-control";
import { campaignControlRequest } from "@/lib/campaign-control-client";
import type { Action } from "../crm";
import { ImportWizard } from "../import-wizard";
import { CampaignControlPanel } from "./campaign-control-panel";
import { CampaignControlLeads } from "./campaign-control-leads";
import { t } from "../ui";
import { useLeaveConfirmation } from "../unsaved-changes";
import { FlowComposer } from "./campaign-flow-composer";
import "./campaign-control.css";
import "./campaign-flow.css";
async function flowRead<T>(query: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`/api/campaigns/flow?${query}`, {
    cache: "no-store",
    signal,
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error || "No se pudo consultar la selección.");
  return body;
}
export function CampaignFlowPanel({
  data,
  locale,
  act,
  changed,
  openConversation,
  initialView = "campaigns",
  initialTemplate,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  changed: () => Promise<void>;
  openConversation: (opportunity: string, conversation: string) => void;
  initialView?: "campaigns" | "leads";
  initialTemplate?: string;
}) {
  const [view, setView] = useState(initialView),
    [importing, setImporting] = useState(false),
    [composing, setComposing] = useState(false);
  const [preferredTemplate, setPreferredTemplate] = useState(initialTemplate);
  const [overview, setOverview] = useState<ControlOverview | null>(null),
    [pool, setPool] = useState<FlowPool | null>(null);
  const [filter, setFilter] = useState("available"),
    [query, setQuery] = useState(""),
    [size, setSize] = useState(20),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const manage =
    ["superadmin", "seller_admin"].includes(data.profile.role) && !data.demo;
  const { requestLeave, confirmation } = useLeaveConfirmation(locale);
  const navigate = (next: "leads" | "campaigns") =>
    requestLeave(() => {
      setComposing(false);
      setView(next);
    });
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    setPage(0);
    setSelected([]);
    setComposing(false);
  }, [filter, query, size]);
  useEffect(() => {
    setSelected([]);
  }, [page]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !composing) refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [composing]);
  useEffect(() => {
    if (data.demo || !manage || view !== "leads") return;
    const abort = new AbortController();
    setLoading(true);
    void Promise.all([
      campaignControlRequest<ControlOverview>("mode=overview", abort.signal),
      flowRead<FlowPool>(
        new URLSearchParams({
          search: query,
          page: String(page),
          size: String(size),
        }).toString(),
        abort.signal,
      ),
    ])
      .then(([o, p]) => {
        if (!abort.signal.aborted) {
          setOverview(o);
          setPool(p);
          setError("");
          setSelected((ids) =>
            ids.filter((id) => p.rows.some((x) => x.contact_id === id)),
          );
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [view, query, page, size, revision, data.demo, manage]);
  const number = (n: number | undefined) =>
    n === undefined
      ? "—"
      : n.toLocaleString(locale === "es" ? "es-CO" : "en-US");
  return (
    <section className="cc-workspace cf-workspace">
      <div className="cf-heading">
        <div>
          <span className="cc-kicker">PIPELINE OS · EMAIL</span>
          <h2>
            {t(
              locale,
              "De tus leads a una conversación",
              "From leads to a conversation",
            )}
          </h2>
        </div>
        <span className="cf-channel">
          <Mail size={15} />
          {t(locale, "Correo", "Email")}
        </span>
      </div>
      <nav
        className="cc-tabs"
        aria-label={t(locale, "Flujo de campañas", "Campaign workflow")}
      >
        <button
          className={view === "leads" ? "selected" : ""}
          aria-pressed={view === "leads"}
          onClick={() => navigate("leads")}
        >
          1 · {t(locale, "Preparar leads", "Prepare leads")}
        </button>
        <button
          className={view === "campaigns" ? "selected" : ""}
          aria-pressed={view === "campaigns"}
          onClick={() => navigate("campaigns")}
        >
          2 · {t(locale, "Campañas y resultados", "Campaigns and results")}
        </button>
      </nav>
      {notice && (
        <p role="status" className="pos-notice">
          {notice}
        </p>
      )}
      {view === "campaigns" ? (
        <CampaignControlPanel
          data={data}
          locale={locale}
          act={act}
          changed={changed}
          create={(template) => {
            setPreferredTemplate(template?.id);
            setView("leads");
            setFilter("available");
            setNotice(
              t(
                locale,
                "Selecciona un lote de leads disponibles para crear la campaña.",
                "Select a batch of available leads to create your campaign.",
              ),
            );
          }}
          openConversation={openConversation}
          campaignsOnly
        />
      ) : (
        <>
          <header className="cc-section-head">
            <div>
              <h3>
                {t(
                  locale,
                  "Prepara una vez. Elige tus próximos contactos.",
                  "Prepare once. Choose your next contacts.",
                )}
              </h3>
              <p>
                {t(
                  locale,
                  "Importa y verifica con Bouncer. Solo los válidos disponibles pueden entrar a una campaña.",
                  "Import and verify with Bouncer. Only valid, available contacts can enter a campaign.",
                )}
              </p>
            </div>
            {manage && (
              <button className="pos-btn" onClick={() => setImporting(true)}>
                <Upload size={15} />
                {t(locale, "Importar Excel", "Import Excel")}
              </button>
            )}
          </header>
          <div
            className="cf-funnel"
            aria-label={t(locale, "Estado de los leads", "Lead status")}
          >
            {(
              [
                ["all", "Total", "total"],
                ["available", "Disponibles", "available"],
                ["valid", "Válidos", "valid"],
                ["pending", "Por validar", "pending"],
                ["running", "En validación", "running"],
                ["review", "Revisar Bouncer", "review"],
                ["uncertain", "Dudosos", "uncertain"],
                ["invalid", "Inválidos", "invalid"],
              ] as const
            ).map(([id, label, key]) =>
              id === "running" ? (
                <div
                  key={id}
                  className="cf-stat"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  title={t(
                    locale,
                    "Verificaciones en cola o que Bouncer está procesando.",
                    "Verifications queued or being processed by Bouncer.",
                  )}
                >
                  <span>{t(locale, "En validación", "Verifying")}</span>
                  <strong>{number(overview?.funnel.running)}</strong>
                </div>
              ) : (
                <button
                  key={id}
                  disabled={composing}
                  className={filter === id ? "selected" : ""}
                  onClick={() => setFilter(id)}
                  aria-pressed={filter === id}
                >
                  <span>{label}</span>
                  <strong>{number(overview?.funnel[key])}</strong>
                </button>
              ),
            )}
          </div>
          {!manage && (
            <p className="pos-info">
              {t(
                locale,
                "La preparación y creación requiere un administrador con MFA.",
                "Preparation and creation require an administrator with MFA.",
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="pos-alert">
              {error}
              <button className="pos-btn" onClick={refresh}>
                {t(locale, "Reintentar", "Retry")}
              </button>
            </p>
          )}
          {filter === "available" ? (
            <section
              className="cc-surface cf-pool"
              aria-busy={loading}
              hidden={composing}
            >
              <div className="cc-section-head">
                <div>
                  <h3>{t(locale, "Leads disponibles", "Available leads")}</h3>
                  <p>
                    {number(pool?.total)}{" "}
                    {t(
                      locale,
                      "contactos libres para primer envío",
                      "contacts available for initial outreach",
                    )}
                  </p>
                </div>
                <button
                  className="pos-btn"
                  aria-label="Actualizar leads"
                  onClick={refresh}
                  disabled={loading}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
              <div className="cf-pool-tools">
                <input
                  aria-label="Buscar leads disponibles"
                  placeholder="Buscar empresa, nombre o correo…"
                  value={query}
                  maxLength={200}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <label>
                  {t(locale, "Tamaño del lote", "Batch size")}
                  <select
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                  >
                    {[20, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="cf-select-all">
                <input
                  type="checkbox"
                  disabled={
                    loading || !pool?.rows.length || !manage || composing
                  }
                  checked={
                    !!pool?.rows.length && selected.length === pool.rows.length
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? pool!.rows.map((x) => x.contact_id)
                        : [],
                    )
                  }
                />
                {t(
                  locale,
                  `Seleccionar este lote (${pool?.rows.length || 0})`,
                  `Select this batch (${pool?.rows.length || 0})`,
                )}
              </label>
              {!pool && loading ? (
                <p role="status">
                  {t(locale, "Consultando leads…", "Loading leads…")}
                </p>
              ) : pool?.rows.length ? (
                <div className="cf-contact-list">
                  {pool.rows.map((x) => (
                    <label key={x.contact_id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(x.contact_id)}
                        disabled={loading || !manage || composing}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, x.contact_id]
                              : ids.filter((id) => id !== x.contact_id),
                          )
                        }
                      />
                      <span>
                        <strong>{x.company || x.name}</strong>
                        <small>
                          {x.name} · {x.email}
                        </small>
                      </span>
                      <span className="cf-valid">
                        <Check size={13} />
                        {t(locale, "Válido", "Valid")}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="cc-empty">
                  <FileSpreadsheet size={27} />
                  <h3>
                    {t(
                      locale,
                      "Este lote no tiene leads disponibles",
                      "No available leads in this batch",
                    )}
                  </h3>
                  <p>
                    {t(
                      locale,
                      "Importa un archivo o revisa la verificación y las exclusiones.",
                      "Import a file or review verification and exclusions.",
                    )}
                  </p>
                </div>
              )}
              <footer className="cf-pool-footer">
                <span>
                  {selected.length} {t(locale, "seleccionados", "selected")}
                </span>
                <div className="pos-row">
                  <button
                    className="pos-btn"
                    disabled={!page || loading || composing}
                    onClick={() => setPage((n) => n - 1)}
                  >
                    ←
                  </button>
                  <span>{page + 1}</span>
                  <button
                    className="pos-btn"
                    disabled={
                      !pool ||
                      (page + 1) * size >= pool.total ||
                      loading ||
                      composing
                    }
                    onClick={() => setPage((n) => n + 1)}
                  >
                    →
                  </button>
                  <button
                    className="pos-btn pos-primary"
                    disabled={
                      !selected.length || loading || !manage || composing
                    }
                    onClick={() => setComposing(true)}
                  >
                    {t(locale, "Crear campaña", "Create campaign")}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </footer>
            </section>
          ) : (
            <CampaignControlLeads
              batch=""
              filter={filter}
              locale={locale}
              manage={manage}
              changed={refresh}
            />
          )}
          {composing && (
            <FlowComposer
              key={selected.join(":")}
              data={data}
              locale={locale}
              contactIds={selected}
              initialTemplate={preferredTemplate}
              close={() => setComposing(false)}
              done={async (id) => {
                setComposing(false);
                setSelected([]);
                setView("campaigns");
                setNotice(
                  t(
                    locale,
                    "Campaña programada. Puedes seguir el primer envío y los recordatorios en Ver resultados.",
                    "Campaign scheduled. Track initial sends and reminders in View results.",
                  ),
                );
                refresh();
                await changed().catch(() => {});
              }}
            />
          )}
          {!!data.imports.length && (
            <details className="cf-imports">
              <summary>
                {t(
                  locale,
                  "Archivos y progreso de importación",
                  "Files and import progress",
                )}
              </summary>
              {data.imports.slice(0, 8).map((b) => (
                <div key={b.id}>
                  <span>{b.name}</span>
                  <small>
                    {b.processed}/{b.total} · {b.status}
                  </small>
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {importing && (
        <ImportWizard
          data={data}
          locale={locale}
          act={act}
          refresh={changed}
          close={() => {
            setImporting(false);
            refresh();
          }}
          verifyOnImport
          returnLabel={t(locale, "Volver a leads", "Back to leads")}
          onRegistered={() => {
            setNotice(
              t(
                locale,
                "Archivo registrado. La importación y Bouncer avanzan en segundo plano; los válidos aparecerán disponibles.",
                "File registered. Import and Bouncer run in the background; valid contacts will become available.",
              ),
            );
            refresh();
          }}
        />
      )}
      {confirmation}
    </section>
  );
}
