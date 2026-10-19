"use client";
import { ProtectedForm, markFormSaved } from "./unsaved-changes";
import { useEffect, useState, type FormEvent } from "react";
import type { Locale, Workspace } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import { teamLabel, type TeamIdentity } from "@/lib/gmail-team";
import { t, Modal } from "./ui";
export function GmailTeamForm({
  email,
  name,
  member,
  workspace,
  locale,
  onSaved,
}: {
  email: string;
  name: string;
  member?: TeamIdentity;
  workspace: Workspace;
  locale: Locale;
  onSaved: () => void;
}) {
  const [role, setRole] = useState(member?.team_role || "seller");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const savedForm = e.currentTarget;
    const f = new FormData(savedForm);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/gmail/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.get("email"),
          name: f.get("name"),
          team_role: role,
          affiliation: f.get("affiliation"),
          profile_id: f.get("profile") || null,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      markFormSaved(savedForm);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ProtectedForm busy={busy} onSubmit={save}>
      <p>
        {t(
          locale,
          "Registrar un correo del equipo conserva sus mensajes. No crea clientes ni concede acceso al CRM o permisos de envío.",
          "Registering a team email preserves messages. It creates no customers and grants no CRM or sending access.",
        )}
      </p>
      <label>
        {t(locale, "Correo del equipo", "Team email")}
        <input
          required
          type="email"
          name="email"
          defaultValue={email}
          readOnly={!!email}
        />
      </label>
      <label>
        {t(locale, "Nombre", "Name")}
        <input
          name="name"
          defaultValue={member?.name || name}
          maxLength={200}
        />
      </label>
      <label>
        {t(locale, "Rol en el equipo", "Team role")}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "seller" | "closer")}
        >
          <option value="seller">Seller</option>
          <option value="closer">Closer</option>
        </select>
      </label>
      <label>
        {t(locale, "Relación con el equipo", "Team affiliation")}
        <select
          name="affiliation"
          defaultValue={member?.affiliation || "internal"}
        >
          <option value="internal">
            {t(locale, "Miembro interno", "Internal member")}
          </option>
          <option value="external">
            {t(locale, "Colaborador externo", "External collaborator")}
          </option>
        </select>
      </label>
      <label>
        {t(
          locale,
          "Usuario del CRM vinculado (opcional)",
          "Linked CRM user (optional)",
        )}
        <select
          name="profile"
          defaultValue={member?.profile_id || ""}
          key={role}
        >
          <option value="">
            {t(locale, "Sin usuario vinculado", "No linked user")}
          </option>
          {workspace.profiles
            .filter(
              (p) =>
                p.active &&
                [role, `${role}_admin`, "superadmin"].includes(p.role),
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.email}
              </option>
            ))}
        </select>
      </label>
      {error && <div className="error-banner">{error}</div>}
      <div className="modal-footer">
        <button className="button primary" disabled={busy}>
          {t(locale, "Guardar miembro del equipo", "Save team member")}
        </button>
      </div>
    </ProtectedForm>
  );
}
export function GmailTeamDirectory({
  members,
  workspace,
  locale,
  onSaved,
}: {
  members: TeamIdentity[];
  workspace: Workspace;
  locale: Locale;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<TeamIdentity | null | undefined>(
    undefined,
  );
  return (
    <details className="gmail-team-directory">
      <summary>
        {t(locale, "Correos del equipo", "Team email directory")} ·{" "}
        {members.length}
      </summary>
      <p>
        {t(
          locale,
          "La clasificación se aplica por correo exacto a todos los análisis. Las conversaciones se asocian por separado y no cambian al responsable.",
          "Classification uses the exact email across analyses. Conversations are associated individually without changing ownership.",
        )}
      </p>
      {members.map((m) => (
        <p key={m.email}>
          <strong>{m.name || m.email}</strong> · {m.email} ·{" "}
          {teamLabel(m, locale)}{" "}
          <button className="text-button" onClick={() => setEditing(m)}>
            {t(locale, "Editar", "Edit")}
          </button>
        </p>
      ))}
      <button className="button" onClick={() => setEditing(null)}>
        {t(locale, "Añadir correo del equipo", "Add team email")}
      </button>
      {editing !== undefined && (
        <Modal
          locale={locale}
          title={t(locale, "Miembro del equipo", "Team member")}
          close={() => setEditing(undefined)}
        >
          <GmailTeamForm
            key={editing?.email || "new"}
            email={editing?.email || ""}
            name={editing?.name || ""}
            member={editing || undefined}
            workspace={workspace}
            locale={locale}
            onSaved={() => {
              setEditing(undefined);
              onSaved();
            }}
          />
        </Modal>
      )}
    </details>
  );
}
type Thread = {
  evidence_id: string;
  subject: string;
  sent_at: string;
  opportunity_id: string | null;
  process_id: string | null;
  submission_id: string | null;
};
type Matches = {
  threads: Thread[];
  cases: { id: string; company: string; email?: string; contact?: string }[];
  pending_candidates?: {
    id: string;
    email: string;
    name: string;
    company_name: string;
  }[];
  pending_associations?: {
    evidence_id: string;
    client_candidate_id: string;
    applied_at: string | null;
    last_error: string | null;
    company_name?: string;
    email?: string;
  }[];
  processes: { id: string; opportunity_id: string; label: string }[];
  submissions: {
    id: string;
    opportunity_id: string;
    process_id: string | null;
    lender_id: string;
  }[];
};
export function GmailTeamThreads({
  candidateId,
  runId,
  locale,
  workspace,
  openSource,
  openCase,
}: {
  candidateId: string;
  runId: string;
  locale: Locale;
  workspace: Workspace;
  openSource: (id: string) => void;
  openCase?: (id: string) => void;
}) {
  const [result, setResult] = useState<Matches>({
    threads: [],
    cases: [],
    processes: [],
    submissions: [],
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [target, setTarget] = useState<Thread | null>(null);
  const [caseId, setCaseId] = useState("");
  const [processId, setProcessId] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  async function load(query = search, evidence = target?.evidence_id) {
    const r = await fetch(
      `/api/gmail/history?${new URLSearchParams({ candidate: candidateId, search: query, thread_page: String(page), ...(evidence ? { evidence } : {}) })}`,
    );
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setResult(body);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [candidateId, page]);
  async function associate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const f = new FormData(e.currentTarget);
    try {
      const pending = caseId.startsWith("pending:");
      const r = await fetch("/api/gmail/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: pending ? "prepare_team_thread" : "team_thread",
          run_id: runId,
          candidate_id: candidateId,
          evidence_id: target!.evidence_id,
          ...(pending
            ? { client_candidate_id: caseId.slice(8) }
            : { opportunity_id: caseId }),
          process_id: processId,
          submission_id: f.get("submission") || null,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      setTarget(null);
      setSuccess(
        pending
          ? t(
              locale,
              "Asociación preparada. Se aplicará cuando confirmes la importación del cliente.",
              "Association prepared. It applies when you confirm the customer import.",
            )
          : t(
              locale,
              "Asociación confirmada. Sus mensajes y los adjuntos seleccionados se incorporarán en segundo plano.",
              "Association confirmed. Its messages and selected attachments will be incorporated in the background.",
            ),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>{t(locale, "Conversaciones del equipo", "Team conversations")}</h3>
      <p>
        {t(
          locale,
          "Revisa el correo y el cliente de cada conversación. Una asociación incluye ese hilo completo; si mezcla clientes, déjalo pendiente. No se asignan todas las conversaciones de este correo a una sola empresa.",
          "Review the email and customer for each conversation. An association includes the entire thread; leave mixed-customer threads pending. This address's conversations are not all assigned to one company.",
        )}
      </p>
      {error && <div className="error-banner">{error}</div>}
      {success && (
        <div className="info-banner" role="status">
          {success}
        </div>
      )}
      {result.threads.slice(0, 50).map((th) => (
        <div className="document-row" key={th.evidence_id}>
          <div>
            <strong>{th.subject}</strong>
            <small>
              {dateLabel(th.sent_at, locale, true)} ·{" "}
              {th.opportunity_id
                ? t(locale, "Asociada al expediente", "Associated case") +
                  " " +
                  (result.cases.find((c) => c.id === th.opportunity_id)
                    ?.company || th.opportunity_id)
                : t(locale, "Pendiente de asociación", "Awaiting association")}
            </small>
            {th.opportunity_id && (
              <small>
                {result.cases.find((c) => c.id === th.opportunity_id)?.email} ·{" "}
                {result.processes.find((p) => p.id === th.process_id)?.label}
                {th.submission_id &&
                  ` · ${workspace.lenders.find((l) => l.id === result.submissions.find((s) => s.id === th.submission_id)?.lender_id)?.name || "Lender"}`}
                {" · "}
                {t(locale, "Asociación confirmada", "Association confirmed")}
              </small>
            )}
            {!th.opportunity_id &&
              result.pending_associations
                ?.filter((p) => p.evidence_id === th.evidence_id)
                .map((p) => (
                  <small key={p.evidence_id}>
                    {p.last_error ||
                      `${t(locale, "Preparada para", "Prepared for")} ${p.company_name || p.email || p.client_candidate_id} · ${t(locale, "pendiente de importar el cliente", "awaiting customer import")}`}
                  </small>
                ))}
          </div>
          <div className="card-actions">
            <button
              className="text-button"
              onClick={() => openSource(th.evidence_id)}
            >
              {t(locale, "Abrir correo", "Open email")}
            </button>
            {!th.opportunity_id && (
              <button
                className="button"
                onClick={() => {
                  setTarget(th);
                  setCaseId("");
                  setProcessId("");
                  setSubmissionId("");
                  setError("");
                  setSuccess("");
                  const query = th.subject
                    .replace(/^(?:(?:re|fwd?):\s*)+/gi, "")
                    .replace(/^funding application\s*[-:]\s*/i, "")
                    .trim();
                  setSearch(query);
                  load(query, th.evidence_id).catch((e) => setError(e.message));
                }}
              >
                {t(locale, "Asociar conversación", "Associate conversation")}
              </button>
            )}
            {th.opportunity_id && openCase && (
              <button
                className="text-button"
                onClick={() => openCase(th.opportunity_id!)}
              >
                {t(locale, "Ver expediente asociado", "View associated case")}
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="card-actions">
        <button
          className="button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          {t(locale, "Anterior", "Previous")}
        </button>
        <span>{page + 1}</span>
        <button
          className="button"
          disabled={result.threads.length <= 50}
          onClick={() => setPage(page + 1)}
        >
          {t(locale, "Siguiente", "Next")}
        </button>
      </div>
      {target && (
        <Modal
          locale={locale}
          wide
          title={t(
            locale,
            "Asociar conversación con un cliente",
            "Associate conversation with a customer",
          )}
          close={() => {
            if (!busy) setTarget(null);
          }}
        >
          <ProtectedForm busy={busy} onSubmit={associate}>
            <h4>{target.subject}</h4>
            <p>
              {t(
                locale,
                "Elige el destino de este hilo. El asunto y los correos son pistas; la asociación requiere tu confirmación.",
                "Choose this thread's destination. Subject and emails are evidence; association requires your confirmation.",
              )}
            </p>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <div className="gmail-connect-form">
              <input
                aria-label={t(
                  locale,
                  "Buscar cliente de la conversación",
                  "Search conversation customer",
                )}
                value={search}
                placeholder={t(
                  locale,
                  "Empresa, nombre o correo del cliente",
                  "Customer company, name or email",
                )}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="button"
                type="button"
                onClick={() => load().catch((e) => setError(e.message))}
              >
                {t(locale, "Buscar expediente", "Search cases")}
              </button>
            </div>
            <label>
              {t(locale, "Expediente confirmado", "Confirmed case")}
              <select
                required
                value={caseId}
                onChange={(e) => {
                  setCaseId(e.target.value);
                  setProcessId("");
                  setSubmissionId("");
                }}
              >
                <option value="">
                  {t(locale, "Seleccionar expediente", "Select case")}
                </option>
                {result.cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company} · {c.contact} · {c.email}
                  </option>
                ))}
                {!!result.pending_candidates?.length && (
                  <optgroup
                    label={t(
                      locale,
                      "Clientes pendientes de importar",
                      "Customers awaiting import",
                    )}
                  >
                    {result.pending_candidates.map((c) => (
                      <option value={`pending:${c.id}`} key={c.id}>
                        {c.company_name || c.name} · {c.email}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {!caseId.startsWith("pending:") && (
              <label>
                {t(locale, "Proceso confirmado", "Confirmed process")}
                <select
                  required
                  value={processId}
                  onChange={(e) => {
                    setProcessId(e.target.value);
                    setSubmissionId("");
                  }}
                >
                  <option value="">
                    {t(locale, "Seleccionar proceso", "Select process")}
                  </option>
                  {result.processes
                    .filter((p) => p.opportunity_id === caseId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {!caseId.startsWith("pending:") && (
              <label>
                {t(
                  locale,
                  "Evaluación del lender (si corresponde)",
                  "Lender evaluation (if applicable)",
                )}
                <select
                  name="submission"
                  value={submissionId}
                  onChange={(e) => setSubmissionId(e.target.value)}
                >
                  <option value="">
                    {t(
                      locale,
                      "Conversación comercial sin evaluación de lender",
                      "Commercial conversation without lender evaluation",
                    )}
                  </option>
                  {result.submissions
                    .filter(
                      (s) =>
                        s.opportunity_id === caseId &&
                        s.process_id === processId,
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {workspace.lenders.find((l) => l.id === s.lender_id)
                          ?.name || s.id}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {caseId && (
              <div className="info-banner">
                <strong>
                  {caseId.startsWith("pending:")
                    ? result.pending_candidates?.find(
                        (c) => c.id === caseId.slice(8),
                      )?.company_name
                    : result.cases.find((c) => c.id === caseId)?.company}
                </strong>
                <p>
                  {caseId.startsWith("pending:")
                    ? result.pending_candidates?.find(
                        (c) => c.id === caseId.slice(8),
                      )?.email
                    : result.cases.find((c) => c.id === caseId)?.email}
                </p>
                <p>
                  {caseId.startsWith("pending:")
                    ? t(
                        locale,
                        "Asociación pendiente hasta confirmar la incorporación del cliente. No crea un expediente ahora.",
                        "Association remains pending until customer import is confirmed. No case is created now.",
                      )
                    : result.processes.find((p) => p.id === processId)?.label ||
                      t(locale, "Selecciona el proceso", "Select the process")}
                </p>
                {submissionId && (
                  <p>
                    {
                      workspace.lenders.find(
                        (l) =>
                          l.id ===
                          result.submissions.find((s) => s.id === submissionId)
                            ?.lender_id,
                      )?.name
                    }
                  </p>
                )}
              </div>
            )}
            <button
              className="button primary"
              disabled={
                busy ||
                !caseId ||
                (!caseId.startsWith("pending:") && !processId)
              }
            >
              {t(
                locale,
                "Confirmar asociación de este hilo",
                "Confirm this thread's association",
              )}
            </button>
          </ProtectedForm>
        </Modal>
      )}
    </section>
  );
}
