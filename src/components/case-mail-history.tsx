"use client";
import { ProtectedForm, markFormSaved } from "./unsaved-changes";
import { useEffect, useState } from "react";
import type { Locale, Workspace } from "@/lib/domain";
import { dateLabel, isCloserRole } from "@/lib/domain";
import { processStates, type ProcessState } from "@/lib/financing-history";
import { MailEvidence } from "./gmail-history";
import { GmailAttachments } from "./gmail-attachments";
import { Modal, t } from "./ui";
type Process = {
  id: string;
  sequence_number: number;
  label: string;
  state: ProcessState;
  classification: string;
  started_at: string;
  is_unclassified_archive: boolean;
};
type Event = {
  id: string;
  process_id: string | null;
  kind: string;
  body: string;
  evidence_type: string;
  occurred_at: string;
  archive_message_id: string | null;
  document_id: string | null;
};
type FileRecord = {
  id: string;
  process_id: string;
  name: string;
  status: string;
  storage_path: string | null;
  received_at: string;
  content_hash: string | null;
  last_error: string | null;
};
type MailCase = {
  processes: Process[];
  events: Event[];
  files: FileRecord[];
  waits: {
    id: string;
    waiting_for: string;
    since_at: string;
    draft: string;
    task_id: string | null;
  }[];
  contacts: {
    relationship: string;
    contacts: { name: string; email: string; phone: string };
  }[];
  has_more?: boolean;
  mail_stats?: {
    sent: number;
    personal: number;
    campaign: number;
    automatic: number;
  };
};
export function CaseMailHistory({
  caseId,
  data,
  locale,
  editable,
  onChanged,
}: {
  caseId: string;
  data: Workspace;
  locale: Locale;
  editable: boolean;
  onChanged: () => Promise<void>;
}) {
  const [history, setHistory] = useState<MailCase>({
    processes: [],
    events: [],
    files: [],
    waits: [],
    contacts: [],
  });
  const [processId, setProcessId] = useState(""),
    [source, setSource] = useState<string | null>(null),
    [modal, setModal] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [state, setState] = useState<ProcessState>("unclassified");
  const [threadSource, setThreadSource] = useState("");
  const [attachmentModal, setAttachmentModal] = useState(false);
  const [page, setPage] = useState(0),
    [drafts, setDrafts] = useState<Record<string, string>>({});
  async function load() {
    if (data.demo) return;
    const r = await fetch(
        `/api/gmail/cases/${caseId}?${new URLSearchParams({ page: String(page), ...(processId ? { process: processId } : {}) })}`,
      ),
      body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setHistory(body);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [
    caseId,
    data.demo,
    processId,
    page,
    data.messages.length,
    data.tasks.length,
  ]);
  async function action(
    input: Record<string, unknown>,
    form?: HTMLFormElement,
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/gmail/cases/${caseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await onChanged();
      await load();
      if (form) markFormSaved(form);
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const events = history.events.filter(
      (e) => !processId || e.process_id === processId,
    ),
    files = history.files.filter(
      (f) => !processId || f.process_id === processId,
    );
  const canLenders =
    data.profile.role === "superadmin" || isCloserRole(data.profile.role);
  const transferRoles = data.opportunities.find((o) => o.id === caseId)
    ?.handed_off_at
    ? ["superadmin", "closer_admin", "closer"]
    : ["superadmin", "seller_admin", "seller"];
  const evidence = [
    ...new Map(
      history.events
        .filter((e) => e.archive_message_id)
        .map((e) => [e.archive_message_id, e]),
    ).values(),
  ];
  return (
    <div className="tab-content case-mail-history">
      <div className="activity-toolbar">
        <h2>
          {t(
            locale,
            "Expediente compartido e histórico",
            "Shared case and history",
          )}{" "}
          · {history.processes.filter((p) => !p.is_unclassified_archive).length}{" "}
          {t(locale, "procesos clasificados", "classified processes")}
        </h2>
        {editable && !data.demo && (
          <div className="card-actions">
            <button className="button" onClick={() => setModal("process")}>
              {t(locale, "Añadir proceso", "Add process")}
            </button>
            <button className="button" onClick={() => setModal("transfer")}>
              {t(
                locale,
                "Cambiar responsable y cuenta",
                "Transfer owner and account",
              )}
            </button>
          </div>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {data.demo && (
        <p className="muted">
          {t(
            locale,
            "El historial Gmail estará disponible al importar una cuenta real.",
            "Gmail history is available after importing a real mailbox.",
          )}
        </p>
      )}
      {history.mail_stats && (
        <p>
          {t(locale, "Correos enviados", "Sent emails")}:{" "}
          {history.mail_stats.sent} · {history.mail_stats.personal}{" "}
          {t(locale, "personales", "personal")} · {history.mail_stats.campaign}{" "}
          {t(locale, "de campañas", "campaign")} ·{" "}
          {history.mail_stats.automatic} {t(locale, "automáticos", "automatic")}
        </p>
      )}
      <label>
        {t(locale, "Proceso de financiación", "Financing process")}
        <select
          value={processId}
          onChange={(e) => {
            setProcessId(e.target.value);
            setPage(0);
          }}
        >
          <option value="">
            {t(locale, "Todos los procesos", "All processes")}
          </option>
          {history.processes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sequence_number} · {p.label} · {p.classification}
            </option>
          ))}
        </select>
      </label>
      {processId && (
        <div className="card-actions">
          <span>
            {
              processStates[
                history.processes.find((p) => p.id === processId)?.state ||
                  "unclassified"
              ]?.[locale === "es" ? 0 : 1]
            }
          </span>
          {editable && (
            <button className="button" onClick={() => setModal("event")}>
              {t(
                locale,
                "Registrar evento con evidencia",
                "Record event with evidence",
              )}
            </button>
          )}
          {editable && canLenders && (
            <button className="button" onClick={() => setModal("lenders")}>
              {t(
                locale,
                "Relacionar o seleccionar lender",
                "Link or select lender",
              )}
            </button>
          )}
        </div>
      )}
      <details>
        <summary>
          {t(locale, "Contactos de la empresa", "Company contacts")}
        </summary>
        {history.contacts.map((c, i) => (
          <p key={i}>
            {c.contacts.name} · {c.contacts.email} · {c.contacts.phone} ·{" "}
            {c.relationship}
          </p>
        ))}
      </details>
      <section>
        <h3>{t(locale, "Seguimientos pendientes", "Pending follow-ups")}</h3>
        {history.waits.map((w) => (
          <details key={w.id}>
            <summary>
              {t(locale, "Esperando", "Waiting for")} {w.waiting_for} ·{" "}
              {dateLabel(w.since_at, locale)} {w.task_id ? "· 5+ días" : ""}
            </summary>
            <p>
              {t(
                locale,
                "Borrador para revisar; no se envía automáticamente.",
                "Draft for review; never sent automatically.",
              )}
            </p>
            <textarea
              aria-label={t(
                locale,
                "Borrador de seguimiento",
                "Follow-up draft",
              )}
              value={drafts[w.id] ?? w.draft}
              onChange={(e) =>
                setDrafts((previous) => ({
                  ...previous,
                  [w.id]: e.target.value,
                }))
              }
              rows={3}
            />
            <button
              className="button"
              onClick={() =>
                navigator.clipboard.writeText(drafts[w.id] ?? w.draft)
              }
            >
              {t(locale, "Copiar borrador", "Copy draft")}
            </button>
            {editable && canLenders && w.waiting_for === "lender" && (
              <details>
                <summary>
                  {t(
                    locale,
                    "Confirmar respuesta del lender transmitida por el equipo",
                    "Confirm lender response relayed by team",
                  )}
                </summary>
                <p>
                  {t(
                    locale,
                    "Solo confirma si el correo del equipo comunica realmente la respuesta del lender. Esto resuelve esta espera y su tarea; no aprueba financiación ni cambia el estado comercial.",
                    "Confirm only if the team email actually relays the lender's response. This resolves this wait and its task; it does not approve financing or change commercial state.",
                  )}
                </p>
                <ProtectedForm
                  busy={busy}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    return action(
                      {
                        operation: "team_response",
                        wait_id: w.id,
                        archive_message_id: f.get("evidence"),
                        note: f.get("note"),
                      },
                      e.currentTarget,
                    );
                  }}
                >
                  <label>
                    {t(locale, "Correo de respaldo", "Evidence email")}
                    <select required name="evidence">
                      <option value="">
                        {t(
                          locale,
                          "Elegir correo y revisar su contenido",
                          "Choose email and review its contents",
                        )}
                      </option>
                      {evidence.map((e) => (
                        <option key={e.id} value={e.archive_message_id!}>
                          {dateLabel(e.occurred_at, locale, true)} ·{" "}
                          {e.body.slice(0, 100)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t(
                      locale,
                      "Respuesta del lender que transmite el equipo",
                      "Lender response relayed by team",
                    )}
                    <textarea required name="note" maxLength={10000} />
                  </label>
                  <button className="button" disabled={busy}>
                    {t(
                      locale,
                      "Confirmar y resolver esta espera",
                      "Confirm and resolve this wait",
                    )}
                  </button>
                </ProtectedForm>
              </details>
            )}
          </details>
        ))}
      </section>
      <section>
        <h3>
          {t(locale, "Documentos y referencias", "Documents and references")}
        </h3>
        <button className="button" onClick={() => setAttachmentModal(true)}>
          {t(
            locale,
            "Seleccionar adjuntos pendientes",
            "Select pending attachments",
          )}
        </button>
        {files.map((f) => (
          <div className="document-row" key={f.id}>
            <div>
              <strong>{f.name}</strong>
              <small>
                {dateLabel(f.received_at, locale)} · {f.status} ·{" "}
                {f.content_hash?.slice(0, 10) ||
                  t(locale, "Referencia en Gmail", "Gmail reference")}
              </small>
              {f.last_error && <small>{f.last_error}</small>}
            </div>
            <div className="card-actions">
              <a className="button" href={`/api/gmail/files/${f.id}`}>
                {t(locale, "Descargar", "Download")}
              </a>
              {editable && !f.storage_path && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setAttachmentModal(true)}
                >
                  {t(locale, "Copiar al expediente", "Copy to case")}
                </button>
              )}
              {editable && f.storage_path && f.status !== "approved" && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    action({
                      operation: "review_file",
                      file_id: f.id,
                      status: (
                        {
                          received: "incorporated",
                          incorporated: "reviewed",
                          reviewed: "approved",
                        } as Record<string, string>
                      )[f.status],
                    })
                  }
                >
                  {
                    (
                      {
                        received: ["Incorporar", "Incorporate"],
                        incorporated: ["Marcar revisado", "Mark reviewed"],
                        reviewed: ["Aprobar", "Approve"],
                      } as Record<string, string[]>
                    )[f.status]?.[locale === "es" ? 0 : 1]
                  }
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
      <h3>{t(locale, "Línea del tiempo", "Timeline")}</h3>
      <p className="muted">
        {t(
          locale,
          "Las ofertas, contratos, aprobación final y desembolso son eventos distintos. Solo se registran con evidencia accesible.",
          "Offers, contracts, final approval and disbursement are separate events. Only accessible evidence supports them.",
        )}
      </p>
      <div className="timeline">
        {events.map((e) => (
          <article key={e.id}>
            <div className="timeline-icon">•</div>
            <div>
              <div className="timeline-meta">
                <strong>
                  {processStates[e.kind as ProcessState]?.[
                    locale === "es" ? 0 : 1
                  ] || e.kind}
                </strong>
                <span>{dateLabel(e.occurred_at, locale, true)}</span>
              </div>
              <small>
                {e.evidence_type} ·{" "}
                {history.processes.find((p) => p.id === e.process_id)?.label}
              </small>
              <p>{e.body}</p>
              {e.archive_message_id && (
                <>
                  <button
                    className="text-button"
                    onClick={() => setSource(e.archive_message_id)}
                  >
                    {t(locale, "Abrir correo de origen", "Open source email")}
                  </button>
                  {editable && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setThreadSource(e.archive_message_id!);
                        setModal("move");
                      }}
                    >
                      {t(
                        locale,
                        "Asignar hilo a un proceso",
                        "Assign thread to process",
                      )}
                    </button>
                  )}
                </>
              )}
              {e.document_id && (
                <a href={`/api/documents/${e.document_id}`}>
                  {t(locale, "Abrir documento", "Open document")}
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="card-actions">
        <button
          className="button"
          disabled={page === 0 || busy}
          onClick={() => setPage(page - 1)}
        >
          {t(locale, "Página anterior", "Previous page")}
        </button>
        <span>{page + 1}</span>
        <button
          className="button"
          disabled={!history.has_more || busy}
          onClick={() => setPage(page + 1)}
        >
          {t(locale, "Página siguiente", "Next page")}
        </button>
      </div>
      {modal && (
        <Modal
          locale={locale}
          title={t(locale, "Histórico del expediente", "Case history")}
          close={() => setModal(null)}
        >
          {error && <div className="error-banner">{error}</div>}
          {modal === "move" && (
            <ProtectedForm
              busy={busy}
              onSubmit={(e) => {
                e.preventDefault();
                return action(
                  {
                    operation: "move_thread",
                    archive_message_id: threadSource,
                    process_id: new FormData(e.currentTarget).get("process"),
                  },
                  e.currentTarget,
                );
              }}
            >
              <p>
                {t(
                  locale,
                  "Esta decisión reasigna los correos y documentos de ese hilo y queda registrada en la línea del tiempo.",
                  "This decision reassigns that thread's emails and files and is recorded in the timeline.",
                )}
              </p>
              <select name="process" required>
                {history.processes
                  .filter((p) => !p.is_unclassified_archive)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !history.processes.some((p) => !p.is_unclassified_archive)
                }
              >
                {t(locale, "Confirmar asociación", "Confirm association")}
              </button>
            </ProtectedForm>
          )}
          {modal === "process" && (
            <ProtectedForm
              busy={busy}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                return action(
                  {
                    operation: "create_process",
                    label: f.get("label"),
                    classification: f.get("classification"),
                    started_at: new Date(String(f.get("date"))).toISOString(),
                    request_key: crypto.randomUUID(),
                  },
                  e.currentTarget,
                );
              }}
            >
              <label>
                {t(locale, "Nombre del proceso", "Process label")}
                <input name="label" required />
              </label>
              <label>
                {t(locale, "Fecha inicial", "Start date")}
                <input name="date" type="date" required />
              </label>
              <label>
                {t(locale, "Clasificación", "Classification")}
                <select name="classification">
                  <option value="unknown">
                    {t(locale, "Pendiente", "Unknown")}
                  </option>
                  <option value="active">
                    {t(locale, "Activo", "Active")}
                  </option>
                  <option value="inactive">
                    {t(locale, "Inactivo", "Inactive")}
                  </option>
                </select>
              </label>
              <button className="button primary" disabled={busy}>
                {t(locale, "Guardar proceso", "Save process")}
              </button>
            </ProtectedForm>
          )}
          {modal === "transfer" && (
            <ProtectedForm
              busy={busy}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                return action(
                  {
                    operation: "transfer",
                    owner_id: f.get("owner"),
                    account_id: f.get("account"),
                  },
                  e.currentTarget,
                );
              }}
            >
              <label>
                {t(locale, "Nuevo responsable", "New owner")}
                <select name="owner" required>
                  {data.profiles
                    .filter((p) => p.active && transferRoles.includes(p.role))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t(locale, "Cuenta principal", "Primary account")}
                <select name="account" required>
                  {data.accounts
                    .filter((a) => a.status === "connected")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.email}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                {t(
                  locale,
                  "El responsable necesita permiso de envío. El historial se conserva y las sincronizaciones futuras no revertirán este cambio.",
                  "The owner needs sender permission. History stays available and future sync cannot reverse this transfer.",
                )}
              </p>
              <button className="button primary" disabled={busy}>
                {t(locale, "Confirmar traspaso", "Confirm transfer")}
              </button>
            </ProtectedForm>
          )}
          {modal === "event" && (
            <ProtectedForm
              busy={busy}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                return action(
                  {
                    operation: "record",
                    process_id: processId,
                    state,
                    archive_message_id: f.get("evidence") || null,
                    document_id: f.get("document") || null,
                    body: f.get("body"),
                    occurred_at: new Date(String(f.get("date"))).toISOString(),
                    funded_amount: f.get("amount")
                      ? Number(f.get("amount"))
                      : null,
                    lender_id: f.get("lender") || null,
                  },
                  e.currentTarget,
                );
              }}
            >
              <label>
                {t(locale, "Evento", "Event")}
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value as ProcessState)}
                >
                  {Object.entries(processStates)
                    .filter(
                      ([key]) =>
                        canLenders ||
                        ![
                          "submitted",
                          "lender_evaluation",
                          "offers",
                          "lender_selected",
                          "requirements",
                          "contract_sent",
                          "contract_signed",
                          "final_approval",
                          "disbursed",
                          "funding_declined",
                        ].includes(key),
                    )
                    .map(([key, names]) => (
                      <option key={key} value={key}>
                        {names[locale === "es" ? 0 : 1]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t(locale, "Fecha del evento", "Event date")}
                <input name="date" type="datetime-local" required />
              </label>
              <label>
                {t(
                  locale,
                  "Descripción del hecho confirmado",
                  "Confirmed fact",
                )}
                <textarea name="body" required rows={3} />
              </label>
              <label>
                {t(locale, "Correo que lo respalda", "Supporting email")}
                <select name="evidence">
                  <option value="">
                    {t(locale, "Elegir evidencia", "Select evidence")}
                  </option>
                  {evidence.map((e) => (
                    <option key={e.id} value={e.archive_message_id || ""}>
                      {e.body} · {dateLabel(e.occurred_at, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(locale, "O documento del expediente", "Or case document")}
                <select name="document">
                  <option value="">—</option>
                  {data.documents
                    .filter((d) => d.opportunity_id === caseId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
              {state === "disbursed" && (
                <>
                  <label>
                    {t(
                      locale,
                      "Importe realmente desembolsado",
                      "Actual funded amount",
                    )}
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Lender
                    <select name="lender" required>
                      {data.lenders.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <button className="button primary" disabled={busy}>
                {t(locale, "Registrar hecho", "Record fact")}
              </button>
            </ProtectedForm>
          )}
          {modal === "lenders" && (
            <>
              <h3>
                {t(
                  locale,
                  "Asociar evaluación al proceso",
                  "Link evaluation to process",
                )}
              </h3>
              {data.submissions
                .filter((s) => s.opportunity_id === caseId)
                .map((s) => (
                  <div className="account-row" key={s.id}>
                    <span>
                      {data.lenders.find((l) => l.id === s.lender_id)?.name} ·{" "}
                      {s.status}
                    </span>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        action({
                          operation: "attach_submission",
                          process_id: processId,
                          submission_id: s.id,
                        })
                      }
                    >
                      {t(locale, "Relacionar", "Link")}
                    </button>
                  </div>
                ))}
              <ProtectedForm
                busy={busy}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  return action(
                    {
                      operation: "select_lender",
                      process_id: processId,
                      submission_id: f.get("submission"),
                      archive_message_id: f.get("evidence"),
                    },
                    e.currentTarget,
                  );
                }}
              >
                <h3>
                  {t(
                    locale,
                    "Seleccionar lender con oferta",
                    "Select lender with offer",
                  )}
                </h3>
                <select name="submission" required>
                  {data.submissions
                    .filter(
                      (s) =>
                        s.opportunity_id === caseId && s.status === "offer",
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {data.lenders.find((l) => l.id === s.lender_id)?.name}
                      </option>
                    ))}
                </select>
                <label>
                  {t(
                    locale,
                    "Correo que confirma la selección",
                    "Email confirming selection",
                  )}
                  <select name="evidence" required>
                    {evidence.map((e) => (
                      <option key={e.id} value={e.archive_message_id || ""}>
                        {e.body}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  {t(
                    locale,
                    "Las otras alternativas del proceso quedarán descartadas por selección de otra oferta. Esto no registra un desembolso.",
                    "Other process alternatives are withdrawn by selection of another offer. This does not record disbursement.",
                  )}
                </p>
                <button className="button primary" disabled={busy}>
                  {t(locale, "Confirmar selección", "Confirm selection")}
                </button>
              </ProtectedForm>
            </>
          )}
        </Modal>
      )}
      {attachmentModal && (
        <GmailAttachments
          caseId={caseId}
          locale={locale}
          editable={editable}
          close={() => setAttachmentModal(false)}
          openSource={setSource}
          saved={async () => {
            await load();
            await onChanged();
          }}
        />
      )}
      {source && (
        <MailEvidence
          id={source}
          locale={locale}
          close={() => setSource(null)}
        />
      )}
    </div>
  );
}
