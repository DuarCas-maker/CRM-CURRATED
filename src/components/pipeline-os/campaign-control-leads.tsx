"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/domain";
import type { ControlLead } from "@/lib/campaign-control";
import {
  campaignControlAction,
  campaignControlRequest,
} from "@/lib/campaign-control-client";
import { verificationReason } from "@/lib/campaign-import-review";
import { Modal, t } from "../ui";
export function CampaignControlLeads({
  batch,
  filter,
  locale,
  manage,
  changed,
}: {
  batch: string;
  filter: string;
  locale: Locale;
  manage: boolean;
  changed: () => void;
}) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
      rows: ControlLead[];
      total: number;
    } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const keys = useRef(new Map<string, string>());
  const [actionError,setActionError]=useState('');
  useEffect(()=>{setConfirm(false);setAccepted(false);},[selected]);
  useEffect(() => {
    setPage(0);
    setSelected([]);
  }, [batch, filter, query]);
  useEffect(() => {
    setSelected([]);
    setConfirm(false);
    setAccepted(false);
  }, [page]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setResult(null);
    const timer = setTimeout(
      () =>
        void campaignControlRequest<{ rows: ControlLead[]; total: number }>(
          new URLSearchParams({
            mode: "leads",
            filter,
            search: query,
            page: String(page),
            ...(batch ? { batch } : {}),
          }).toString(),
          abort.signal,
        )
          .then((r) => {
            if (abort.signal.aborted) return;
            setResult(r);
            setError("");
            setSelected((ids) =>
              ids.filter((id) =>
                r.rows.some((x) => x.contact_id === id && x.retryable),
              ),
            );
            if (page > 0 && page * 50 >= r.total)
              setPage(Math.max(0, Math.ceil(r.total / 50) - 1));
          })
          .catch((e) => {
            if (!abort.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setLoading(false);
          }),
      200,
    );
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [batch, filter, query, page, revision]);
  const selectable =
    result?.rows
      .filter((x) => x.retryable && !x.suppressed)
      .map((x) => x.contact_id) || [];
  const technical = result?.rows.some(
    (x) => selected.includes(x.contact_id) && x.state === "technical_error",
  );
  async function verify() {
    if (busy || !accepted || !selected.length || loading || !result) return;
    setBusy(true);
    setActionError("");
    try {
      const r = await campaignControlAction(
        "verify",
        {
          batch: batch || null,
          contact_ids: [...selected].sort(),
          expected_count: selected.length,
          cause_resolved: accepted,
        },
        keys.current,
      );
      setNotice(
        t(
          locale,
          `${r.queued} verificaciones autorizadas. Esta operación no activa campañas.`,
          `${r.queued} verifications authorized. This action does not activate campaigns.`,
        ),
      );
      setSelected([]);
      setConfirm(false);
      changed();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
      setRevision((n) => n + 1);
    }
  }
  return (
    <section className="cc-surface cc-leads" aria-busy={loading}>
      <div className="cc-section-head cc-verification-header">
        <div>
          <h3>
            {t(locale, "Contactos y verificación", "Contacts and verification")}
          </h3>
          <p>
            {t(
              locale,
              "Revisa los motivos antes de gastar créditos. La selección se limita a esta página.",
              "Review reasons before using credits. Selection applies to this page only.",
            )}
          </p>
        </div>
        <div className="cc-verification-tools">
          <input
            aria-label={t(
              locale,
              "Buscar contacto de la base",
              "Search pool contacts",
            )}
            placeholder={t(
              locale,
              "Buscar empresa, contacto o correo…",
              "Search company, contact or email…",
            )}
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {manage && (
            <button
              className="pos-btn pos-primary"
              disabled={!selected.length || loading || busy}
              onClick={() => {
                setAccepted(false);
                setConfirm(true);
              }}
            >
              {t(
                locale,
                "Revisar verificación con Bouncer",
                "Review Bouncer verification",
              )}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="pos-alert">
          {error}
          <button className="pos-btn" onClick={() => setRevision((n) => n + 1)}>
            {t(locale, "Reintentar consulta", "Retry query")}
          </button>
        </p>
      )}
      {actionError&&<p role="alert" className="pos-alert">{actionError}</p>}
      {notice && (
        <p role="status" className="pos-notice">
          {notice}
        </p>
      )}
      {filter === "review" && (
        <p className="cc-callout">
          {t(
            locale,
            "Un error 402 significa que la última solicitud fue rechazada por créditos insuficientes. Revisa el saldo en Bouncer. Las solicitudes inciertas requieren conciliación y no se pueden repetir.",
            "Error 402 means the last request was rejected for insufficient credits. Check your Bouncer balance. Unknown request outcomes require reconciliation and cannot be retried.",
          )}{" "}
          <a
            href="https://app.usebouncer.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Bouncer ↗
          </a>
        </p>
      )}
      {loading ? (
        <p role="status">
          {t(locale, "Consultando contactos…", "Loading contacts…")}
        </p>
      ) : (
        result && (
          <>
            {manage && (
              <label className="cc-check">
                <input
                  type="checkbox"
                  checked={
                    !!selectable.length && selected.length === selectable.length
                  }
                  disabled={!selectable.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? selectable : [])
                  }
                />
                {t(
                  locale,
                  "Seleccionar verificables de esta página",
                  "Select verifiable contacts on this page",
                )}{" "}
                · {result.total} {t(locale, "contactos", "contacts")}
                {selected.length > 0 && (
                  <> · {selected.length} {t(locale, "seleccionados", "selected")}</>
                )}
              </label>
            )}
            {!result.rows.length ? (
              <p className="cc-empty">
                {t(
                  locale,
                  "No hay contactos con estos filtros.",
                  "No contacts match these filters.",
                )}
              </p>
            ) : (
              <div className="cc-contact-list">
                {result.rows.map((row) => (
                  <label className="cc-contact-row" key={row.contact_id}>
                    {manage && (
                      <input
                        type="checkbox"
                        checked={selected.includes(row.contact_id)}
                        disabled={!row.retryable || row.suppressed}
                        aria-label={t(
                          locale,
                          `Verificar ${row.email}`,
                          `Verify ${row.email}`,
                        )}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, row.contact_id]
                              : ids.filter((id) => id !== row.contact_id),
                          )
                        }
                      />
                    )}
                    <span>
                      <strong>{row.company || row.name}</strong>
                      <span>
                        {row.name} · {row.email}
                      </span>
                    </span>
                    <span className="cc-contact-note">
                      {row.suppressed
                        ? t(
                            locale,
                            "Baja o bloqueo; excluido.",
                            "Suppressed; excluded.",
                          )
                        : verificationReason(
                            { ...row, reason_code: row.reason_code },
                            locale,
                          )}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="cc-pagination">
              <span>
                {page + 1} / {Math.max(1, Math.ceil(result.total / 50))}
              </span>
              <button
                className="pos-btn"
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                {t(locale, "Anterior", "Previous")}
              </button>
              <button
                className="pos-btn"
                disabled={(page + 1) * 50 >= result.total}
                onClick={() => setPage((n) => n + 1)}
              >
                {t(locale, "Siguiente", "Next")}
              </button>
            </div>
          </>
        )
      )}
      {confirm && (
        <div className="cc-modal-host">
          <Modal
            locale={locale}
            dirty={false}
            busy={busy}
            close={() => setConfirm(false)}
            title={t(
              locale,
              "Confirmar uso de Bouncer",
              "Confirm Bouncer usage",
            )}
          >
            {actionError&&<p role="alert" className="pos-alert">{actionError}</p>}
            <p>
              {t(
                locale,
                `Autorizarás ${selected.length} verificaciones que pueden consumir créditos. No se activarán campañas ni se enviarán correos.`,
                `You will authorize ${selected.length} verifications that may use credits. No campaign will be activated and no emails will be sent.`,
              )}
            </p>
            <label className="cc-check">
              <input
                type="checkbox"
                checked={accepted}
                disabled={busy}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              {technical
                ? t(
                    locale,
                    "Resolví la causa de los errores y autorizo este consumo.",
                    "I resolved the errors and authorize this usage.",
                  )
                : t(
                    locale,
                    "Revisé la cantidad y autorizo este consumo.",
                    "I reviewed the count and authorize this usage.",
                  )}
            </label>
            <div className="pos-row">
              <button
                className="pos-btn pos-primary"
                disabled={busy || !accepted || !selected.length}
                onClick={() => void verify()}
              >
                {busy
                  ? t(locale, "Solicitando…", "Requesting…")
                  : t(
                      locale,
                      `Confirmar ${selected.length} verificaciones`,
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
          </Modal>
        </div>
      )}
    </section>
  );
}
