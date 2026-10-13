"use client";
import {
  useEffect,
  useState,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { RefreshCw, ChevronDown } from "lucide-react";
import type { Workspace, Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { MailDraft } from "@/lib/mail-manager";
import { Modal, t } from "./ui";
export type MailboxState = {
  review_page?: number;
  pending_total?: number;
  accounts: {
    id: string;
    email: string;
    status: string;
    last_synced_at: string | null;
    job?: { status: string; last_error: string | null };
  }[];
  pending: {
    id?: string;
    gmail_thread_id?: string;
    review_id: string;
    subject: string;
    account_id: string;
    sent_at: string;
    participants: { role: string; email: string }[];
  }[];
  drafts: { id: string; payload: MailDraft; updated_at: string }[];
};
export function MailboxStatus({
  data,
  locale,
  caseId,
  onChanged,
  onDraft,
  compact = false,
  onState,
  reviewToOpen,
  pendingPage,
  onPendingPageChange,
  onPendingSelect,
  onReviewClosed,
}: {
  data: Workspace;
  locale: Locale;
  caseId?: string;
  onChanged: () => void;
  onDraft: (draft: MailDraft) => void;
  compact?: boolean;
  onState?: (state: MailboxState) => void;
  reviewToOpen?: string | null;
  pendingPage?: number;
  onPendingPageChange?: Dispatch<SetStateAction<number>>;
  onPendingSelect?: () => void;
  onReviewClosed?: () => void;
}) {
  const [state, setState] = useState<MailboxState>({
    accounts: [],
    pending: [],
    drafts: [],
  });
  const [error, setError] = useState(""),
    [readError, setReadError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [review, setReview] = useState<MailboxState["pending"][number] | null>(
    null,
  );
  const [target, setTarget] = useState(""),
    [process, setProcess] = useState(""),
    [submission, setSubmission] = useState("");
  const [details, setDetails] = useState<{
    processes: { id: string; label: string }[];
    submissions: { id: string; lender_id: string; process_id: string | null }[];
  }>({ processes: [], submissions: [] });
  const [body, setBody] = useState("");
  const [revision, setRevision] = useState(0);
  const [localReviewPage, setLocalReviewPage] = useState(0);
  const reviewPage = pendingPage ?? localReviewPage;
  const setReviewPage = onPendingPageChange || setLocalReviewPage;
  const stateListener = useRef(onState);
  stateListener.current = onState;
  useEffect(() => {
    stateListener.current?.({ ...state, review_page: reviewPage });
  }, [state, reviewPage]);
  useEffect(() => {
    const item = state.pending.find((p) => p.review_id === reviewToOpen);
    if (item) {
      setReview(item);
      setTarget("");
      setCaseQuery("");
      setError("");
    }
  }, [reviewToOpen]);
  const lastRead = useRef("");
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [caseQuery, setCaseQuery] = useState("");
  const [caseChoices, setCaseChoices] = useState(data.opportunities);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!caseQuery.trim()) {
      setCaseChoices(data.opportunities);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(
        `/api/workspace?${new URLSearchParams({ q: caseQuery, view: "opportunities" })}`,
        { signal: controller.signal },
      )
        .then(async (r) => {
          const p = await r.json();
          if (!r.ok) throw Error(p.error);
          setCaseChoices(p.opportunities);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [caseQuery, data.opportunities]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const r = await fetch(
          `/api/mail?${new URLSearchParams({ review_page: String(reviewPage), ...(caseId ? { case: caseId } : {}) })}`,
          { signal: controller.signal },
        );
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        if (!controller.signal.aborted) {
          setState(p);
          setReadError("");
          const signature = p.accounts
            .map(
              (a: MailboxState["accounts"][number]) =>
                `${a.id}:${a.last_synced_at || ""}`,
            )
            .sort()
            .join("|");
          if (lastRead.current && signature !== lastRead.current)
            changed.current();
          lastRead.current = signature;
        }
      } catch (e) {
        if (!controller.signal.aborted) setReadError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [caseId, revision, reviewPage]);
  useEffect(() => {
    setDetails({ processes: [], submissions: [] });
    setProcess("");
    setSubmission("");
    if (!target) return;
    const controller = new AbortController();
    fetch(`/api/conversations/channels?case=${target}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        setDetails(p);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [target]);
  useEffect(() => {
    setBody("");
    if (!review) return;
    const controller = new AbortController();
    fetch(`/api/mail/review/${review.review_id}`, { signal: controller.signal })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        setBody(p.body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [review]);
  async function action(action: string, payload: unknown) {
    const r = await fetch("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        request_id: crypto.randomUUID(),
        payload,
      }),
    });
    const p = await r.json();
    if (!r.ok) throw Error(p.error);
    setRevision((r) => r + 1);
    onChanged();
  }
  const labels: Record<string, [string, string]> = {
    queued: ["En cola", "Queued"],
    running: ["Sincronizando", "Synchronizing"],
    completed: ["Último trabajo completado", "Last job completed"],
    failed: ["Error de sincronización", "Sync error"],
    paused: ["Sincronización pausada", "Sync paused"],
  };
  async function refreshMail() {
    setBusy(true);
    setError("");
    try {
      await action("sync", {
        ...(caseId ? { opportunity_id: caseId } : {}),
        account_ids: state.accounts
          .filter((a) => a.status === "connected")
          .map((a) => a.id),
      });
      setNotice(
        t(
          locale,
          "Sincronización solicitada. Los correos aparecerán cuando el trabajador complete la lectura.",
          "Synchronization requested. Emails appear when the worker completes the read.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const lastSync = state.accounts
    .map((a) => a.last_synced_at)
    .filter((at): at is string => !!at)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return (
    <section className={compact ? "cw-sync" : "panel settings-panel"}>
      {compact && (
        <div className="cw-sync-line">
          <span
            className={`cw-sync-dot ${readError || state.accounts.some((a) => a.job?.status === "failed" || a.status !== "connected") ? "warning" : ""}`}
          />
          <strong>{t(locale, "Gmail", "Gmail")}</strong>
          <span>
            {state.accounts.length
              ? `${state.accounts.length} ${t(locale, "cuenta(s)", "account(s)")}`
              : t(locale, "Sin cuentas disponibles", "No available accounts")}
          </span>
          <small>
            {state.accounts.some((a) =>
              ["queued", "running"].includes(a.job?.status || ""),
            )
              ? t(locale, "Lectura en curso", "Read in progress")
              : lastSync
                ? `${t(locale, "Última lectura", "Last read")}: ${dateLabel(lastSync, locale, true)}`
                : t(
                    locale,
                    "Sin primera lectura registrada",
                    "No initial read recorded",
                  )}
          </small>
          <button className="cw-link" type="button" onClick={onPendingSelect}>
            {t(locale, "Sin asociar", "Unassociated")} ·{" "}
            {state.pending_total ?? state.pending.length}
          </button>
          <button
            className="cw-link"
            type="button"
            disabled={
              busy || !state.accounts.some((a) => a.status === "connected")
            }
            onClick={() => void refreshMail()}
          >
            <RefreshCw size={13} />
            {t(locale, "Actualizar", "Refresh")}
          </button>
        </div>
      )}
      {compact && (error || readError) && (
        <p className="cw-inline-error" role="alert">
          {error || readError}
        </p>
      )}
      {compact && notice && (
        <span className="cw-sync-notice" role="status" title={notice}>
          {t(locale, "Lectura solicitada", "Read requested")}
        </span>
      )}
      <details
        className={compact ? "cw-mailbox-details" : "mailbox-full-details"}
        open={!compact}
      >
        {compact && (
          <summary>
            <ChevronDown size={13} />
            {t(locale, "Cuentas y borradores", "Accounts and drafts")}
          </summary>
        )}
        <div className="conversation-header">
          <h2>{t(locale, "Recepción de correo", "Mail reception")}</h2>
          <button
            className="button"
            disabled={
              busy || !state.accounts.some((a) => a.status === "connected")
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await action("sync", {
                  ...(caseId ? { opportunity_id: caseId } : {}),
                  account_ids: state.accounts
                    .filter((a) => a.status === "connected")
                    .map((a) => a.id),
                });
                setNotice(
                  t(
                    locale,
                    "Sincronización solicitada. Los correos aparecerán cuando el trabajador complete la lectura.",
                    "Synchronization requested. Emails appear when the worker completes the read.",
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {compact && <RefreshCw size={13} />}
            {t(locale, "Actualizar correo", "Refresh mail")}
          </button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {readError && (
          <div className="error-banner" role="alert">
            {readError}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
        {state.accounts.map((a) => (
          <div className="account-row" key={a.id}>
            <div>
              <strong>{a.email}</strong>
              <small>
                {t(locale, "Última sincronización", "Last synchronized")}:{" "}
                {a.last_synced_at
                  ? dateLabel(a.last_synced_at, locale, true)
                  : t(
                      locale,
                      "Pendiente de primera lectura",
                      "Awaiting first read",
                    )}
              </small>
            </div>
            <span className="badge">
              {a.status !== "connected"
                ? t(locale, "Reconectar cuenta", "Reconnect account")
                : a.job
                  ? t(
                      locale,
                      ...(labels[a.job.status] || [a.job.status, a.job.status]),
                    )
                  : t(locale, "Esperando trabajador", "Waiting for worker")}
            </span>
          </div>
        ))}
        <p className="muted">
          {t(
            locale,
            "La recepción se consulta aproximadamente cada minuto y funciona mientras se revisa el histórico.",
            "Reception is checked approximately every minute and runs during historical review.",
          )}
        </p>
        <details>
          <summary>
            {t(locale, "Hilos nuevos por asociar", "New threads to associate")}{" "}
            · {state.pending_total ?? state.pending.length}
          </summary>
          {state.pending.map((p) => (
            <div className="document-row" key={p.review_id}>
              <div>
                <strong>
                  {p.subject || t(locale, "Sin asunto", "No subject")}
                </strong>
                <small>
                  {p.participants.find((a) => a.role === "from")?.email} ·{" "}
                  {dateLabel(p.sent_at, locale, true)}
                </small>
              </div>
              <button
                className="button"
                onClick={() => {
                  setReview(p);
                  setTarget("");
                  setCaseQuery("");
                  setError("");
                }}
              >
                {t(locale, "Asociar al expediente", "Associate with a case")}
              </button>
            </div>
          ))}
          <div className="card-actions">
            <button
              className="button"
              disabled={reviewPage === 0 || busy}
              onClick={() => setReviewPage((p) => p - 1)}
            >
              {t(locale, "Anterior", "Previous")}
            </button>
            <button
              className="button"
              disabled={
                (reviewPage + 1) * 50 >= (state.pending_total || 0) || busy
              }
              onClick={() => setReviewPage((p) => p + 1)}
            >
              {t(locale, "Siguiente", "Next")}
            </button>
          </div>
        </details>
        <details>
          <summary>
            {t(locale, "Mis borradores del expediente", "My case drafts")} ·{" "}
            {state.drafts.length}
          </summary>
          {state.drafts.map((d) => (
            <div className="document-row" key={d.id}>
              <div>
                <strong>
                  {d.payload.subject || t(locale, "Sin asunto", "No subject")}
                </strong>
                <small>{dateLabel(d.updated_at, locale, true)}</small>
              </div>
              <button
                className="button"
                onClick={() => onDraft({ ...d.payload, id: d.id })}
              >
                {t(locale, "Continuar borrador", "Continue draft")}
              </button>
            </div>
          ))}
        </details>
      </details>
      {review && (
        <Modal
          title={t(
            locale,
            "Asociar hilo recibido",
            "Associate received thread",
          )}
          close={() => {
            if (!busy) {
              setReview(null);
              onReviewClosed?.();
            }
          }}
        >
          <p>
            <strong>{review.subject}</strong>
          </p>
          <p
            style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}
          >
            {body}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await action("associate", {
                  review_id: review.review_id,
                  opportunity_id: target,
                  process_id: process || null,
                  submission_id: submission || null,
                });
                setReview(null);
                onReviewClosed?.();
                setNotice(
                  t(
                    locale,
                    "Hilo asociado. Sus mensajes y adjuntos se incorporarán en segundo plano.",
                    "Thread associated. Messages and attachments will be incorporated in the background.",
                  ),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              {t(
                locale,
                "Buscar expediente por empresa, contacto o correo",
                "Find case by company, contact or email",
              )}
              <input
                value={caseQuery}
                disabled={busy}
                maxLength={150}
                onChange={(e) => {
                  setCaseQuery(e.target.value);
                  setTarget("");
                }}
              />
            </label>
            {searching && (
              <p role="status">{t(locale, "Buscando…", "Searching…")}</p>
            )}
            <label className="field">
              {t(locale, "Expediente", "Case")}
              <select
                required
                value={target}
                disabled={busy || searching}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">
                  {t(locale, "Seleccionar expediente", "Select a case")}
                </option>
                {caseChoices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.company} · {o.contact}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t(locale, "Proceso", "Process")}
              <select
                value={process}
                disabled={busy || !target}
                onChange={(e) => {
                  setProcess(e.target.value);
                  setSubmission("");
                }}
              >
                <option value="">
                  {t(
                    locale,
                    "Pendiente de clasificar",
                    "Awaiting classification",
                  )}
                </option>
                {details.processes.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t(
                locale,
                "Solicitud al lender, si corresponde",
                "Lender evaluation, if applicable",
              )}
              <select
                value={submission}
                disabled={busy || !process}
                onChange={(e) => setSubmission(e.target.value)}
              >
                <option value="">
                  {t(
                    locale,
                    "Correo de cliente o equipo",
                    "Customer or team email",
                  )}
                </option>
                {details.submissions
                  .filter((s) => s.process_id === process)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {data.lenders.find((l) => l.id === s.lender_id)?.name ||
                        s.lender_id}{" "}
                      · {s.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={busy || !target}>
              {t(
                locale,
                "Confirmar asociación de este hilo",
                "Confirm this thread's association",
              )}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
