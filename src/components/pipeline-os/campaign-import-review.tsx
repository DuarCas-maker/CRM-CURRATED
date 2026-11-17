"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { Locale } from "@/lib/domain";
import {
  importReviewSchema,
  verificationReason,
  type ImportReview,
  type reviewFilters,
} from "@/lib/campaign-import-review";
import { Modal, t } from "../ui";

export function CampaignImportReview({
  batch,
  locale,
  close,
  changed,
}: {
  batch: string;
  locale: Locale;
  close: () => void;
  changed: () => void;
}) {
  const [result, setResult] = useState<ImportReview | null>(null);
  const [filter, setFilter] =
    useState<(typeof reviewFilters)[number]>("attention");
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false),
    [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    setSelected([]);
    setConfirm(false);
    setResolved(false);
  }, [filter, search, page]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setResult(null);
    setLoading(true);
    async function read() {
      try {
        const q = new URLSearchParams({
          mode: "review",
          batch,
          filter,
          search,
          page: String(page),
        });
        const r = await fetch("/api/campaigns/import?" + q, {
          signal: abort.signal,
          cache: "no-store",
        });
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        const parsed = importReviewSchema.parse(json);
        if (abort.signal.aborted) return;
        setResult(parsed);
        if (page > 0 && page * 50 >= parsed.total) {
          setPage(Math.max(0, Math.ceil(parsed.total / 50) - 1));
          return;
        }
        setSelected((ids) => {
          const current = ids.filter((id) =>
            parsed.rows.some((row) => row.contact_id === id && row.retryable),
          );
          return current.length === ids.length ? ids : current;
        });
        if (parsed.summary.running) timer = setTimeout(() => void read(), 5000);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    const debounce = setTimeout(() => void read(), 200);
    return () => {
      abort.abort();
      clearTimeout(timer);
      clearTimeout(debounce);
    };
  }, [batch, filter, search, page, revision]);
  useEffect(() => {
    setConfirm(false);
    setResolved(false);
  }, [selected]);
  async function retry() {
    if (busy || !resolved || !selected.length || loading || !result || !confirm)
      return;
    const ids = [...selected].sort();
    if (
      !ids.every((id) =>
        result.rows.some((row) => row.contact_id === id && row.retryable),
      )
    )
      return;
    const fingerprint = `${batch}:${ids.join(",")}`;
    let key = keys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(fingerprint, key);
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/campaigns/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "retry",
          batch,
          contact_ids: ids,
          expected_count: ids.length,
          request_key: key,
        }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error);
      keys.current.delete(fingerprint);
      setSelected([]);
      setConfirm(false);
      setResolved(false);
      setNotice(
        t(
          locale,
          `${json.queued} ${json.queued === 1 ? "contacto en cola" : "contactos en cola"} de verificación. La campaña sigue sin activar.`,
          `${json.queued} ${json.queued === 1 ? "contact" : "contacts"} queued for verification. The campaign is not active.`,
        ),
      );
      changed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setRevision((x) => x + 1);
    }
  }
  const choices = [
    ["attention", "Requieren revisión", "Need review"],
    ["technical", "Errores técnicos", "Technical errors"],
    ["reconciliation", "Por conciliar", "Reconciliation needed"],
    ["uncertain", "Dudosos", "Uncertain"],
    ["valid", "Válidos", "Valid"],
    ["invalid", "Inválidos", "Invalid"],
    ["all", "Todos", "All"],
  ];
  const selectable =
    result?.rows.filter((row) => row.retryable).map((row) => row.contact_id) ||
    [];
  return (
    <div className="cs-review-host">
      <Modal
        wide
        locale={locale}
        dirty={false}
        busy={busy}
        close={close}
        title={t(
          locale,
          "Revisión de contactos del archivo",
          "Review file contacts",
        )}
      >
        <div className="cs-review-body">
          <p className="pos-muted">
            {t(
              locale,
              "Consulta los motivos y reintenta solo después de resolver la causa. Los contactos sin validación no entran en el envío.",
              "Review reasons and retry only after resolving the cause. Unverified contacts are excluded from sending.",
            )}
          </p>
          {!!result?.summary.insufficient_credits && (
            <div className="cs-callout" role="status">
              <strong>
                {t(
                  locale,
                  `${result.summary.insufficient_credits} solicitudes rechazadas por créditos insuficientes`,
                  `${result.summary.insufficient_credits} requests rejected for insufficient credits`,
                )}
              </strong>
              <p>
                {t(
                  locale,
                  "Este fue el motivo de la última solicitud. Revisa el saldo en Bouncer antes de reintentar; aquí no se compran créditos.",
                  "This was the reason for the last request. Check your Bouncer balance before retrying; credits are not purchased here.",
                )}
              </p>
              <a
                href="https://app.usebouncer.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t(locale, "Abrir Bouncer", "Open Bouncer")} ↗
              </a>
            </div>
          )}
          {!!result?.summary.reconciliation && (
            <p className="pos-info">
              {t(
                locale,
                "Las solicitudes de resultado incierto requieren conciliación antes de repetirlas. Permanecen bloqueadas para evitar duplicar consumo.",
                "Requests with unknown outcomes require reconciliation before retrying. They remain blocked to avoid duplicate usage.",
              )}
            </p>
          )}
          {error && (
            <p role="alert" className="pos-alert">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="pos-notice">
              {notice}
            </p>
          )}
          <div className="cs-review-tools">
            <label>
              <Search size={16} />
              <input
                aria-label={t(locale, "Buscar contacto", "Search contacts")}
                maxLength={200}
                placeholder={t(
                  locale,
                  "Buscar nombre, empresa o correo…",
                  "Search name, company or email…",
                )}
                value={search}
                disabled={busy}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <select
              aria-label={t(
                locale,
                "Filtrar clasificación",
                "Filter classification",
              )}
              value={filter}
              disabled={busy}
              onChange={(e) => {
                setFilter(e.target.value as typeof filter);
                setPage(0);
              }}
            >
              {choices.map(([id, es, en]) => (
                <option key={id} value={id}>
                  {t(locale, es, en)}
                </option>
              ))}
            </select>
            <button
              className="pos-btn"
              disabled={busy || loading}
              onClick={() => {
                setError("");
                setRevision((x) => x + 1);
              }}
            >
              <RefreshCw size={14} />
              {t(locale, "Actualizar", "Refresh")}
            </button>
          </div>
          <div className="cs-review-list" aria-busy={loading}>
            {loading && (
              <p role="status">
                {t(locale, "Consultando contactos…", "Loading contacts…")}
              </p>
            )}
            {!loading && result && (
              <>
                <div className="cs-review-list-head">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={t(
                        locale,
                        "Seleccionar reintentables de esta página",
                        "Select retryable contacts on this page",
                      )}
                      disabled={busy || !selectable.length}
                      checked={
                        !!selectable.length &&
                        selected.length === selectable.length
                      }
                      onChange={(e) => {
                        setSelected(e.target.checked ? selectable : []);
                        setConfirm(false);
                        setResolved(false);
                      }}
                    />
                    {t(locale, "Seleccionar página", "Select page")}
                  </label>
                  <span>
                    {result.total} {t(locale, "contactos", "contacts")}
                  </span>
                </div>
                {!result.rows.length && (
                  <p className="cs-empty">
                    {t(
                      locale,
                      "No hay contactos con estos filtros.",
                      "No contacts match these filters.",
                    )}
                  </p>
                )}
                {result.rows.map((row) => (
                  <label className="cs-contact" key={row.contact_id}>
                    <input
                      type="checkbox"
                      disabled={busy || !row.retryable}
                      checked={selected.includes(row.contact_id)}
                      aria-label={t(
                        locale,
                        `Seleccionar ${row.email}`,
                        `Select ${row.email}`,
                      )}
                      onChange={(e) => {
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, row.contact_id]
                            : ids.filter((id) => id !== row.contact_id),
                        );
                        setConfirm(false);
                        setResolved(false);
                      }}
                    />
                    <span className="cs-contact-person">
                      <strong>{row.name || row.email}</strong>
                      <span>{row.email}</span>
                      <small>{row.company}</small>
                    </span>
                    <span className="cs-contact-reason">
                      <span
                        className={`cs-badge ${row.state === "technical_error" ? "warning" : ""}`}
                      >
                        {t(
                          locale,
                          row.state === "technical_error"
                            ? "Error técnico"
                            : row.retryable
                              ? "Reintentable"
                              : ["uncertain_request", "review"].includes(
                                    row.state || "",
                                  )
                                ? "Por conciliar"
                                : row.verification === "valid"
                                  ? "Válido"
                                  : row.verification === "uncertain"
                                    ? "Dudoso"
                                    : row.verification === "invalid"
                                      ? "Inválido"
                                      : "En proceso",
                          row.state === "technical_error"
                            ? "Technical error"
                            : ["uncertain_request", "review"].includes(
                                  row.state || "",
                                )
                              ? "Reconciliation"
                              : row.verification,
                        )}
                      </span>
                      <span>{verificationReason(row, locale)}</span>
                      {!row.retryable && row.state === "technical_error" && (
                        <small>
                          {t(
                            locale,
                            "No elegible para reintento: revisa acceso, baja o clasificación actual.",
                            "Retry unavailable: check access, suppression or current classification.",
                          )}
                        </small>
                      )}
                    </span>
                  </label>
                ))}
              </>
            )}
          </div>
          <div className="cs-review-pagination">
            <button
              className="pos-btn"
              disabled={busy || loading || page === 0}
              onClick={() => setPage((x) => x - 1)}
            >
              {t(locale, "Anterior", "Previous")}
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil((result?.total || 0) / 50))}
            </span>
            <button
              className="pos-btn"
              disabled={
                busy || loading || !result || (page + 1) * 50 >= result.total
              }
              onClick={() => setPage((x) => x + 1)}
            >
              {t(locale, "Siguiente", "Next")}
            </button>
          </div>
          {confirm ? (
            <section
              className="cs-callout"
              aria-label={t(locale, "Confirmar reintento", "Confirm retry")}
            >
              <strong>
                {t(
                  locale,
                  `Reintentar ${selected.length} ${selected.length === 1 ? "contacto" : "contactos"} con Bouncer`,
                  `Retry ${selected.length} contacts with Bouncer`,
                )}
              </strong>
              <p>
                {t(
                  locale,
                  `Autorizarás hasta ${selected.length} ${selected.length === 1 ? "verificación que puede consumir créditos" : "verificaciones que pueden consumir créditos"} de Bouncer. No se activará la campaña ni se enviarán correos.`,
                  `You will authorize up to ${selected.length} verifications that may use Bouncer credits. The campaign will not be activated and no emails will be sent.`,
                )}
              </p>
              <label className="cs-check">
                <input
                  type="checkbox"
                  checked={resolved}
                  disabled={busy}
                  onChange={(e) => setResolved(e.target.checked)}
                />
                {t(
                  locale,
                  "Ya resolví la causa del error y autorizo este consumo.",
                  "I resolved the error's cause and authorize this usage.",
                )}
              </label>
              <div className="pos-row">
                <button
                  className="pos-btn pos-primary"
                  disabled={busy || loading || !resolved || !selected.length}
                  onClick={() => void retry()}
                >
                  {busy
                    ? t(locale, "Solicitando…", "Requesting…")
                    : t(
                        locale,
                        `Confirmar ${selected.length} ${selected.length === 1 ? "verificación" : "verificaciones"}`,
                        `Confirm ${selected.length} verifications`,
                      )}
                </button>
                <button
                  className="pos-btn"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  {t(locale, "Cancelar", "Cancel")}
                </button>
              </div>
            </section>
          ) : (
            <div className="cs-review-footer">
              <span>
                {selected.length}{" "}
                {t(
                  locale,
                  "seleccionados · solo errores técnicos",
                  "selected · technical errors only",
                )}
              </span>
              <button
                className="pos-btn pos-primary"
                disabled={busy || loading || !selected.length}
                onClick={() => {
                  setConfirm(true);
                  setResolved(false);
                }}
              >
                <ShieldCheck size={16} />
                {t(locale, "Revisar reintento", "Review retry")}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
