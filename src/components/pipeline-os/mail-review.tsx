"use client";
import { useEffect, useRef, useState } from "react";
import { currency, type Locale } from "@/lib/domain";
import {
  mailApprovalSchema,
  type MailApproval,
  type MailProposal,
  type MailReview,
  type MailReviewPage,
} from "@/lib/pipeline-os/mail-review";
import { readableMail } from "@/lib/mail-display";
import { ProtectedForm } from "../unsaved-changes";
import { t } from "../ui";

const blank: MailProposal = {
  kind: "unknown",
  amount: null,
  product: "",
  term: "",
  cost: "",
  frequency: "",
  fees: "",
  expires_at: null,
  requirement: "",
  summary: "",
  task_title: "",
  evidence: [],
};
const fixtureId = (n: number) =>
  `53000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function examplePage(): MailReviewPage {
  return {
    messages: [
      {
        id: fixtureId(1),
        subject: "Demo: funding offer",
        sender: "offers@lender.example",
        sent_at: "2026-11-12T15:00:00Z",
        body: "MCA offer: $50,000. Term: 24 weeks. Please provide AR aging.",
        process_id: fixtureId(2),
        submission_id: fixtureId(3),
        review: null,
      },
    ],
    processes: [{ id: fixtureId(2), label: "Proceso ficticio" }],
    submissions: [
      {
        id: fixtureId(3),
        process_id: fixtureId(2),
        lender_name: "Lender de ejemplo",
      },
    ],
    owners: [{ id: fixtureId(4), name: "Responsable de ejemplo" }],
    owner_id: fixtureId(4),
    next_cursor: null,
  };
}
export function PipelineMailReview({
  caseId,
  locale,
  demo,
  changed,
  leave,
}: {
  caseId: string;
  locale: Locale;
  demo: boolean;
  changed(): Promise<void>;
  leave(action: () => void): void;
}) {
  const [page, setPage] = useState<MailReviewPage | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [messageId, setMessageId] = useState(""),
    [processId, setProcessId] = useState(""),
    [submissionId, setSubmissionId] = useState(""),
    [review, setReview] = useState<MailReview | null>(null),
    [value, setValue] = useState<MailApproval>({
      ...blank,
      kind: "offer",
      owner_id: "",
      due_at: new Date(Date.now() + 86400000).toISOString(),
    }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [readVersion, setReadVersion] = useState(0);
  const analyzeKey = useRef(""),
    approvalKey = useRef("");
  const message = page?.messages.find((m) => m.id === messageId);
  const l = (es: string, en: string) => t(locale, es, en);
  function select(m: MailReviewPage["messages"][number], p: MailReviewPage) {
    setMessageId(m.id);
    setProcessId(m.process_id || m.review?.process_id || "");
    setSubmissionId(m.submission_id || m.review?.submission_id || "");
    installReview(m.review, p);
    analyzeKey.current = "";
    approvalKey.current = "";
    setNotice("");
    setError("");
  }
  function installReview(r: MailReview | null, p = page) {
    setReview(r);
    const proposal = r?.approved_value || r?.proposal || blank;
    setValue({
      ...proposal,
      kind: proposal.kind === "requirement" ? "requirement" : "offer",
      owner_id: r?.approved_value?.owner_id || p?.owner_id || "",
      due_at:
        r?.approved_value?.due_at ||
        new Date(Date.now() + 86400000).toISOString(),
    });
  }
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        const p: MailReviewPage = demo
          ? examplePage()
          : await readPage(abort.signal);
        if (abort.signal.aborted) return;
        setPage(p);
        if (p.messages[0]) select(p.messages[0], p);
        else {
          setMessageId("");
          setReview(null);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => abort.abort();
    // Context/page changes reset the selection only after the parent leave guard.
  }, [caseId, cursor, demo, readVersion]);
  async function readPage(signal?: AbortSignal) {
    const q = new URLSearchParams({
      case_id: caseId,
      ...(cursor ? { before: cursor } : {}),
    });
    const response = await fetch(`/api/pipeline-os/mail-review?${q}`, {
      signal,
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body as MailReviewPage;
  }
  async function post(body: object) {
    const response = await fetch("/api/pipeline-os/mail-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result as { review: MailReview };
  }
  async function analyze(retry = false) {
    if (!message || !processId || !submissionId) return;
    setBusy(true);
    setError("");
    setNotice("");
    analyzeKey.current ||= crypto.randomUUID();
    try {
      if (demo) {
        const proposal: MailProposal = {
          ...blank,
          kind: "offer",
          amount: 50000,
          product: "MCA",
          term: "24 weeks",
          summary: "Oferta ficticia por 50.000 USD; revisar AR aging.",
          task_title: "Revisar oferta y solicitar AR aging",
          evidence: [
            { field: "amount", quote: "$50,000" },
            { field: "term", quote: "24 weeks" },
          ],
        };
        installReview({
          id: fixtureId(5),
          message_id: message.id,
          opportunity_id: caseId,
          process_id: processId,
          submission_id: submissionId,
          revision: (review?.revision || 0) + 2,
          status: "ready",
          proposal,
          approved_value: null,
          result: null,
          error_code: null,
        });
      } else {
        const body = await post({
          operation: "analyze",
          message_id: message.id,
          process_id: processId,
          submission_id: submissionId,
          request_key: analyzeKey.current,
          retry,
          revision: review?.revision,
        });
        installReview(body.review);
      }
    } catch (e) {
      setError((e as Error).message);
      // Recovery is read-only: show the durable failed/ready attempt, never repeat the paid request.
      if (!demo)
        try {
          const p = await readPage();
          setPage(p);
          const m = p.messages.find((m) => m.id === messageId);
          if (m) installReview(m.review, p);
        } catch {
          /* keep the original error */
        }
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      // Strip evidence from the AI proposal: approval contains editable values, not invented citations.
      const clean = mailApprovalSchema.parse(
        Object.fromEntries(
          Object.entries(value).filter(([k]) => k !== "evidence"),
        ),
      );
      approvalKey.current ||= crypto.randomUUID();
      const approved = demo
        ? {
            ...review,
            status: "approved" as const,
            approved_value: clean,
            result: {
              offer_id: clean.kind === "offer" ? fixtureId(6) : null,
              requirement_id:
                clean.kind === "requirement" ? fixtureId(7) : null,
              task_id: fixtureId(8),
              event_id: fixtureId(9),
            },
          }
        : (
            await post({
              operation: "approve",
              review_id: review.id,
              revision: review.revision,
              request_key: approvalKey.current,
              value: clean,
            })
          ).review;
      setReview(approved);
      setNotice(
        l(
          "Revisión guardada: registro comercial, tarea y update creados una sola vez.",
          "Review saved: commercial record, task and update created once.",
        ),
      );
      if (!demo)
        try {
          await changed();
        } catch {
          setNotice(
            l(
              "La revisión quedó guardada. No se pudo actualizar el panel; actualiza la lectura sin repetir la aprobación.",
              "Review saved. Refresh the panel without repeating approval.",
            ),
          );
        }
    } catch (e) {
      setError(e instanceof Error ? e.message : "MAIL_REVIEW_INVALID");
    } finally {
      setBusy(false);
    }
  }
  const edit = <K extends keyof MailApproval>(key: K, v: MailApproval[K]) => {
    approvalKey.current = "";
    setValue((current) => ({ ...current, [key]: v }));
  };
  const matchesReview =
    !review ||
    (review.process_id === processId && review.submission_id === submissionId);
  return (
    <details className="pos-card pos-mail-review">
      <summary>
        <strong>{l("Revisar correo con IA", "Review email with AI")}</strong>
      </summary>
      <p className="pos-small pos-muted">
        {demo
          ? l(
              "Ejemplo ficticio y temporal; no usa IA ni envía correos.",
              "Fictional, temporary example; no AI calls or emails.",
            )
          : l(
              "Analiza un correo recibido. Revisa los datos antes de crear una oferta o requisito, una tarea y un update. No envía correos.",
              "Analyze a received email. Review before creating an offer or requirement, task and update. No emails are sent.",
            )}
      </p>
      {loading && (
        <p role="status">{l("Cargando correos…", "Loading emails…")}</p>
      )}
      {error && (
        <p className="pos-alert" role="alert">
          {reviewError(error, locale)}
        </p>
      )}
      <button
        type="button"
        className="pos-btn pos-sm"
        disabled={busy || loading}
        onClick={() => leave(() => setReadVersion((v) => v + 1))}
      >
        {l("Actualizar lectura", "Refresh saved state")}
      </button>
      {notice && (
        <p className="pos-notice" role="status">
          {notice}
        </p>
      )}
      {!loading && page && (
        <>
          {!page.messages.length ? (
            <p>
              {l(
                "No hay correos entrantes asociados. Usa Pendientes de Conversaciones para elegir expediente y proceso; no se crean expedientes automáticamente.",
                "No linked inbound mail. Use Pending in Conversations to choose an existing file and process; no files are created automatically.",
              )}
            </p>
          ) : (
            <>
              <label>
                {l("Correo de origen", "Source email")}
                <select
                  value={messageId}
                  disabled={busy}
                  onChange={(e) => {
                    const m = page.messages.find(
                      (m) => m.id === e.target.value,
                    );
                    if (m) leave(() => select(m, page));
                  }}
                >
                  {page.messages.map((m) => (
                    <option key={m.id} value={m.id}>
                      {new Date(m.sent_at).toLocaleDateString(
                        locale === "es" ? "es-CO" : "en-US",
                      )}{" "}
                      · {m.subject} ·{" "}
                      {review?.message_id === m.id
                        ? reviewStatus(review.status, locale)
                        : m.review
                          ? reviewStatus(m.review.status, locale)
                          : l("Sin analizar", "Not analyzed")}
                    </option>
                  ))}
                </select>
              </label>
              {message && (
                <details>
                  <summary>
                    {l("Ver vista previa del correo", "View email preview")}
                  </summary>
                  <p>{message.sender}</p>
                  <pre>{readableMail(message.body).text}</pre>
                  <small>
                    {l(
                      "Puedes consultar el mensaje completo desde Conversaciones, en la cabecera del expediente.",
                      "Open Conversations in the file header to read the full message.",
                    )}
                  </small>
                </details>
              )}
              <div className="form-grid">
                <label>
                  {l("Proceso existente", "Existing process")}
                  <select
                    value={processId}
                    disabled={
                      busy ||
                      review?.status === "approved" ||
                      review?.status === "analyzing" ||
                      !!message?.process_id
                    }
                    onChange={(e) => {
                      const id = e.target.value;
                      leave(() => {
                        setProcessId(id);
                        setSubmissionId("");
                        analyzeKey.current = "";
                      });
                    }}
                  >
                    <option value="">
                      {l("Selecciona un proceso", "Select a process")}
                    </option>
                    {page.processes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {l(
                    "Evaluación de lender existente",
                    "Existing lender evaluation",
                  )}
                  <select
                    value={submissionId}
                    disabled={
                      busy ||
                      review?.status === "approved" ||
                      review?.status === "analyzing" ||
                      !!message?.submission_id
                    }
                    onChange={(e) => {
                      const id = e.target.value;
                      leave(() => {
                        setSubmissionId(id);
                        analyzeKey.current = "";
                      });
                    }}
                  >
                    <option value="">
                      {l("Selecciona un lender", "Select a lender")}
                    </option>
                    {page.submissions
                      .filter((s) => s.process_id === processId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.lender_name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {!processId || !submissionId ? (
                <p>
                  {l(
                    "Asocia el proceso y la evaluación correctos antes de analizar. Las coincidencias por nombre no se aplican automáticamente.",
                    "Choose the correct process and evaluation before analysis. Name matches are never applied automatically.",
                  )}
                </p>
              ) : null}
              {!review && (
                <button
                  type="button"
                  className="pos-btn pos-primary"
                  disabled={busy || !processId || !submissionId}
                  onClick={() => void analyze()}
                >
                  {busy
                    ? l("Analizando…", "Analyzing…")
                    : l("Analizar correo", "Analyze email")}
                </button>
              )}
              {review?.status === "analyzing" && (
                <p role="status">
                  {l(
                    "El intento está en curso o su resultado es incierto. Actualiza la lectura antes de reintentar.",
                    "Attempt in progress or outcome uncertain. Refresh before retrying.",
                  )}
                </p>
              )}
              {review &&
                ["failed", "analyzing", "ready"].includes(review.status) && (
                  <button
                    type="button"
                    className="pos-btn"
                    disabled={busy || !processId || !submissionId}
                    onClick={() => {
                      leave(() => {
                        analyzeKey.current = crypto.randomUUID();
                        void analyze(true);
                      });
                    }}
                  >
                    {l(
                      "Reintentar análisis (puede consumir IA)",
                      "Retry analysis (may incur AI usage)",
                    )}
                  </button>
                )}
              {review?.status === "ready" && !matchesReview && (
                <p role="status">
                  {l(
                    "Cambió la evaluación elegida. Vuelve a analizar antes de aprobar; se conservará el intento anterior.",
                    "The selected evaluation changed. Analyze again before approval; the previous attempt is retained.",
                  )}
                </p>
              )}
              {review?.status === "ready" && matchesReview && (
                <ProtectedForm
                  key={review.id + ":" + review.revision}
                  busy={busy}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void approve();
                  }}
                >
                  <h4>
                    {l(
                      "Propuesta para revisión humana",
                      "Proposal for human review",
                    )}
                  </h4>
                  {review.proposal?.kind === "unknown" && (
                    <p role="status">
                      {l(
                        "La IA no pudo identificar una propuesta verificable. Completa los datos solo con evidencia del mensaje.",
                        "AI could not identify a verifiable proposal. Complete values only from message evidence.",
                      )}
                    </p>
                  )}
                  <div className="form-grid">
                    <label>
                      {l("Tipo", "Type")}
                      <select
                        value={value.kind}
                        disabled={busy}
                        onChange={(e) =>
                          edit("kind", e.target.value as MailApproval["kind"])
                        }
                      >
                        <option value="offer">{l("Oferta", "Offer")}</option>
                        <option value="requirement">
                          {l("Requisito", "Requirement")}
                        </option>
                      </select>
                    </label>
                    {value.kind === "offer" && (
                      <>
                        <label>
                          {l("Importe USD", "Amount USD")}
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            required
                            value={value.amount ?? ""}
                            onChange={(e) =>
                              edit(
                                "amount",
                                e.target.value ? Number(e.target.value) : null,
                              )
                            }
                          />
                        </label>
                        {(
                          [
                            ["product", "Producto", "Product"],
                            ["term", "Plazo", "Term"],
                            ["cost", "Costo / factor", "Cost / factor"],
                            ["frequency", "Frecuencia", "Frequency"],
                            ["fees", "Comisiones", "Fees"],
                          ] as const
                        ).map(([key, es, en]) => (
                          <label key={key}>
                            {l(es, en)}
                            <input
                              required={key === "product"}
                              maxLength={key === "product" ? 100 : 1000}
                              value={value[key]}
                              onChange={(e) => edit(key, e.target.value)}
                            />
                          </label>
                        ))}
                        <label>
                          {l(
                            "Vencimiento de oferta (si consta)",
                            "Offer expiration (if stated)",
                          )}
                          <input
                            type="datetime-local"
                            value={localDate(value.expires_at)}
                            onChange={(e) =>
                              edit(
                                "expires_at",
                                e.target.value
                                  ? new Date(e.target.value).toISOString()
                                  : null,
                              )
                            }
                          />
                        </label>
                      </>
                    )}
                    {value.kind === "requirement" && (
                      <label>
                        {l("Requisito solicitado", "Requested requirement")}
                        <textarea
                          required
                          maxLength={3000}
                          value={value.requirement}
                          onChange={(e) => edit("requirement", e.target.value)}
                        />
                      </label>
                    )}
                    <label>
                      {l("Update", "Update")}
                      <textarea
                        required
                        maxLength={2000}
                        value={value.summary}
                        onChange={(e) => edit("summary", e.target.value)}
                      />
                    </label>
                    <label>
                      {l("Próxima tarea", "Next task")}
                      <input
                        required
                        maxLength={300}
                        value={value.task_title}
                        onChange={(e) => edit("task_title", e.target.value)}
                      />
                    </label>
                    <label>
                      {l("Responsable", "Owner")}
                      <select
                        required
                        value={value.owner_id}
                        onChange={(e) => edit("owner_id", e.target.value)}
                      >
                        {page.owners.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {l(
                        "Vencimiento de tarea (hora local)",
                        "Task due (local time)",
                      )}
                      <input
                        required
                        type="datetime-local"
                        value={localDate(value.due_at)}
                        onChange={(e) =>
                          edit(
                            "due_at",
                            e.target.value
                              ? new Date(e.target.value).toISOString()
                              : "",
                          )
                        }
                      />
                    </label>
                  </div>
                  <details>
                    <summary>
                      {l("Evidencia citada por la IA", "AI-cited evidence")}
                    </summary>
                    {review.proposal?.evidence.map((e, i) => (
                      <blockquote key={i}>
                        {e.field}: {e.quote}
                      </blockquote>
                    ))}
                  </details>
                  <button className="pos-btn pos-primary" disabled={busy}>
                    {busy
                      ? l("Guardando…", "Saving…")
                      : l(
                          "Aprobar y crear registro, tarea y update",
                          "Approve and create record, task and update",
                        )}
                  </button>
                </ProtectedForm>
              )}
              {review?.status === "approved" && (
                <div role="status">
                  <strong>
                    {l("Aprobado y registrado", "Approved and recorded")}
                  </strong>
                  <p>{review.approved_value?.summary}</p>
                  <dl className="pos-settings">
                    <dt>
                      {review.approved_value?.kind === "offer"
                        ? l("Oferta registrada", "Recorded offer")
                        : l("Requisito registrado", "Recorded requirement")}
                    </dt>
                    <dd>
                      {review.approved_value?.kind === "offer"
                        ? `${currency(review.approved_value.amount || 0, locale)} · ${review.approved_value.product} · ${review.approved_value.term}`
                        : review.approved_value?.requirement}
                    </dd>
                    <dt>{l("Responsable de la tarea", "Task owner")}</dt>
                    <dd>
                      {page.owners.find(
                        (o) => o.id === review.approved_value?.owner_id,
                      )?.name || "—"}
                    </dd>
                    <dt>{l("Vencimiento de tarea", "Task due")}</dt>
                    <dd>
                      {review.approved_value?.due_at
                        ? new Date(review.approved_value.due_at).toLocaleString(
                            locale === "es" ? "es-CO" : "en-US",
                          )
                        : "—"}
                    </dd>
                  </dl>
                  <p>{review.approved_value?.task_title}</p>
                  <small>
                    {l("Correo de origen", "Source email")}: {message?.subject}
                  </small>
                </div>
              )}
            </>
          )}
          <div className="pos-row">
            <button
              type="button"
              className="pos-btn"
              disabled={busy || !cursor}
              onClick={() => leave(() => setCursor(null))}
            >
              {l("Primeros correos", "First emails")}
            </button>
            <button
              type="button"
              className="pos-btn"
              disabled={busy || !page.next_cursor}
              onClick={() => leave(() => setCursor(page.next_cursor))}
            >
              {l("Más correos", "More emails")}
            </button>
          </div>
        </>
      )}
    </details>
  );
}
function localDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function reviewError(error: string, locale: Locale) {
  const messages: Record<string, [string, string]> = {
    MR_STALE: [
      "La revisión cambió o el análisis sigue en curso. Actualiza la lectura; un intento incierto solo puede repetirse después de cinco minutos.",
      "Review changed or analysis is in progress. Refresh; an uncertain attempt may only be retried after five minutes.",
    ],
    MR_ALREADY_APPROVED: [
      "El correo ya fue aprobado. Actualiza la lectura para consultar el resultado guardado.",
      "Email already approved. Refresh to see the saved result.",
    ],
    MR_CONTEXT_CHANGED: [
      "Cambió el correo o su asociación. Revisa el expediente y el proceso antes de continuar.",
      "Email or association changed. Review the file and process before continuing.",
    ],
    MR_ASSOCIATION_REQUIRED: [
      "Selecciona un proceso confirmado y su evaluación de lender. Si el hilo está asociado a otro proceso, corrígelo primero en Conversaciones.",
      "Choose a confirmed process and lender evaluation. Correct a different thread association in Conversations first.",
    ],
    MR_OWNER_INVALID: [
      "Selecciona un responsable activo con acceso comercial a este expediente.",
      "Choose an active owner with commercial access to this file.",
    ],
    MR_NOT_CONFIGURED: [
      "El servicio de IA no está configurado para esta revisión. Solicita revisar la configuración del servidor.",
      "AI is not configured for this review. Ask an administrator to review server configuration.",
    ],
    MR_ANALYSIS_FAILED: [
      "No se pudo completar o guardar el análisis. Actualiza la lectura antes de solicitar otro intento.",
      "Analysis could not be completed or saved. Refresh before requesting another attempt.",
    ],
    OPENAI_RESULT_UNCERTAIN: [
      "No se confirmó el resultado de IA. No se repetirá automáticamente; revisa el estado guardado.",
      "AI outcome was not confirmed. It will not be repeated automatically; check the saved state.",
    ],
  };
  return messages[error]?.[locale === "es" ? 0 : 1] || error;
}
function reviewStatus(status: MailReview["status"], locale: Locale) {
  const labels: Record<MailReview["status"], [string, string]> = {
    analyzing: ["Análisis en curso", "Analysis in progress"],
    ready: ["Propuesta pendiente de revisión", "Proposal awaiting review"],
    failed: ["Análisis por revisar", "Analysis requires attention"],
    approved: ["Aprobado y registrado", "Approved and recorded"],
  };
  return labels[status][locale === "es" ? 0 : 1];
}
