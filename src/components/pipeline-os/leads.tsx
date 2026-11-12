"use client";
import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Upload } from "lucide-react";
import type { Lead, Locale, Workspace } from "@/lib/domain";
import { getLeadTab, type LeadTab } from "@/lib/lead-tabs";
import type { Action } from "../crm";
import { Modal, t } from "../ui";
import type { OpenPipelineCase } from "./board";

export function PipelineLeads({
  data,
  locale,
  act,
  busy,
  importing,
  open,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  importing: () => void;
  open: OpenPipelineCase;
}) {
  const [tab, setTab] = useState<LeadTab>("preparing"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false);
  const [rows, setRows] = useState<Lead[]>([]),
    [total, setTotal] = useState(0),
    [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setSelected([]);
    if (data.demo) {
      const filtered = data.leads.filter(
        (l) =>
          getLeadTab(l) === tab &&
          `${l.company} ${l.email}`.toLowerCase().includes(query.toLowerCase()),
      );
      setRows(filtered.slice(page * 100, page * 100 + 100));
      setTotal(filtered.length);
      setMore((page + 1) * 100 < filtered.length);
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      void fetch(
        `/api/workspace?${new URLSearchParams({ view: "leads", lead_section: tab, lead_status: tab, q: query, page: String(page) })}`,
        { signal: abort.signal, cache: "no-store" },
      )
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw new Error(b.error);
          if (!abort.signal.aborted) {
            setRows(b.leads);
            setTotal(b.listTotal);
            setMore(b.hasMore);
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [data, tab, query, page, revision]);
  const eligible = rows.filter(
    (l) =>
      !l.suppressed &&
      ["pending", "uncertain"].includes(l.verification) &&
      !["queued", "submitted", "uncertain_request", "review"].includes(
        l.verification_state || "",
      ),
  );
  const ids = new Set(
    eligible.filter((l) => selected.includes(l.id)).map((l) => l.contact_id),
  );
  async function verify() {
    setError("");
    try {
      await act("verify_contacts", { contact_ids: [...ids] });
      setSelected([]);
      setConfirm(false);
      setRevision((r) => r + 1);
      setNotice(
        t(
          locale,
          "Verificación solicitada. Los resultados dependen del worker y del proveedor; no se activó ninguna campaña.",
          "Verification requested. Results depend on the worker and provider; no campaign was activated.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section aria-busy={loading}>
      <div className="pos-info">
        <ShieldCheck size={18} />
        <span>
          {t(
            locale,
            "Importar, verificar y activar campaña son pasos separados. Un resultado incierto sigue pendiente de revisión.",
            "Importing, verification and campaign activation are separate steps. Uncertain results still require review.",
          )}
        </span>
      </div>
      <div className="pos-row pos-module-actions">
        <button className="pos-btn pos-primary" onClick={importing}>
          <Upload size={15} />
          {t(locale, "Importar CSV / XLSX", "Import CSV / XLSX")}
        </button>
        <button
          className="pos-btn"
          disabled={!ids.size || busy || loading}
          onClick={() => setConfirm(true)}
        >
          <ShieldCheck size={15} />
          {t(locale, "Verificar seleccionados", "Verify selected")} ({ids.size})
        </button>
        <button
          className="pos-icon-btn"
          onClick={() => setRevision((r) => r + 1)}
          aria-label={t(locale, "Actualizar leads", "Refresh leads")}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div
        className="pos-tabs"
        role="tablist"
        aria-label={t(locale, "Estado de leads", "Lead status")}
      >
        {(["preparing", "converted", "risk"] as LeadTab[]).map((x) => (
          <button
            role="tab"
            aria-selected={x === tab}
            key={x}
            onClick={() => {
              setTab(x);
              setPage(0);
              setSelected([]);
            }}
          >
            {x === "preparing"
              ? t(locale, "Por preparar", "To prepare")
              : x === "converted"
                ? t(locale, "Convertidos", "Converted")
                : t(locale, "Inválidos / en riesgo", "Invalid / at risk")}
          </button>
        ))}
      </div>
      <div className="pos-filters">
        <label>
          {t(locale, "Buscar lead", "Search lead")}{" "}
          <input
            type="search"
            maxLength={200}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
              setSelected([]);
            }}
          />
        </label>
        <span className="pos-small pos-muted">{total} leads</span>
      </div>
      {error && (
        <p className="pos-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="pos-notice" role="status">
          {notice}
        </p>
      )}
      <div className="pos-card pos-scroll">
        <table className="pos-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={t(
                    locale,
                    "Seleccionar verificables de esta página",
                    "Select eligible leads on this page",
                  )}
                  checked={
                    eligible.length > 0 &&
                    eligible.every((l) => selected.includes(l.id))
                  }
                  disabled={!eligible.length || busy}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? eligible.map((l) => l.id) : [],
                    )
                  }
                />
              </th>
              <th>{t(locale, "Negocio", "Business")}</th>
              <th>{t(locale, "Contacto", "Contact")}</th>
              <th>{t(locale, "Verificación", "Verification")}</th>
              <th>{t(locale, "Próximo paso", "Next step")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${t(locale, "Seleccionar", "Select")} ${l.company}`}
                    checked={selected.includes(l.id)}
                    disabled={!eligible.some((x) => x.id === l.id) || busy}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, l.id]
                          : s.filter((x) => x !== l.id),
                      )
                    }
                  />
                </td>
                <td>
                  <b>{l.company}</b>
                  <div className="pos-small pos-muted">{l.contact}</div>
                </td>
                <td>
                  {l.email}
                  <div className="pos-small pos-muted">{l.phone}</div>
                </td>
                <td>
                  <span className="pos-pill">{l.verification}</span>
                  {l.suppressed && (
                    <span className="pos-pill pos-p1">
                      {t(locale, "Baja / bloqueado", "Opt-out / blocked")}
                    </span>
                  )}
                  <div className="pos-small pos-muted">
                    {l.verification_state || ""}
                  </div>
                </td>
                <td>
                  {l.opportunity_id ? (
                    <button
                      className="pos-text-btn"
                      onClick={() => open(l.opportunity_id!)}
                    >
                      {t(locale, "Abrir expediente", "Open file")}
                    </button>
                  ) : (
                    l.next_action || "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="pos-empty">
            {loading
              ? t(locale, "Cargando…", "Loading…")
              : t(
                  locale,
                  "No hay leads con estos filtros.",
                  "No leads match these filters.",
                )}
          </p>
        )}
      </div>
      <div className="pos-pagination">
        <span>{page + 1}</span>
        <button
          className="pos-btn pos-sm"
          disabled={!page || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          {t(locale, "Anterior", "Previous")}
        </button>
        <button
          className="pos-btn pos-sm"
          disabled={!more || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          {t(locale, "Siguiente", "Next")}
        </button>
      </div>
      {confirm && (
        <Modal
          title={t(locale, "Confirmar verificación", "Confirm verification")}
          locale={locale}
          busy={busy}
          close={() => setConfirm(false)}
        >
          <div className="pos-card">
            <p>
              {t(
                locale,
                `Se solicitará verificar ${ids.size} contactos seleccionados. Esta acción puede consumir el presupuesto del proveedor. No envía correos.`,
                `Request verification for ${ids.size} selected contacts. This may consume provider budget. No emails will be sent.`,
              )}
            </p>
            <button
              className="pos-btn pos-primary"
              disabled={!ids.size || busy}
              onClick={() => void verify()}
            >
              {t(locale, "Confirmar verificación", "Confirm verification")}
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </section>
  );
}
