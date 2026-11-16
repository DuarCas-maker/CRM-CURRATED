"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { currency, type Locale, type Workspace } from "@/lib/domain";
import {
  canManageCaseFlow,
  latestConfirmation,
  type CaseFlowCommand,
  type CaseFlowInput,
  type FlowSnapshot,
} from "@/lib/pipeline-os/case-flow";
import { Modal, t } from "../ui";
import {
  ProtectedForm,
  markFormSaved,
  useLeaveConfirmation,
} from "../unsaved-changes";
import "./case-flow-controls.css";

function demoSnapshot(data: Workspace, caseId: string): FlowSnapshot {
  const o = data.opportunities.find((o) => o.id === caseId);
  return {
    caseId,
    processId: null,
    canManage: !!o && canManageCaseFlow(data.profile, o),
    processes: [],
    events: [],
    evidence: data.documents
      .filter((d) => d.opportunity_id === caseId && d.storage_path)
      .map((d) => ({ id: d.id, type: "document", label: d.name })),
    lenders: data.lenders.map((l) => ({
      id: l.id,
      name: l.name,
      submission_id: null,
      process_id: null,
      offered_amount: null,
      selected: false,
      requirements_state: "not_requested",
      agreed_amount: null,
    })),
  };
}
function useFlow(
  data: Workspace,
  caseId: string,
  process: string | null,
  changed: () => Promise<void>,
) {
  const [snapshot, setSnapshot] = useState<FlowSnapshot | null>(() =>
    data.demo ? demoSnapshot(data, caseId) : null,
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const key = useRef<{ text: string; key: string } | null>(null),
    context = useRef(caseId);
  context.current = caseId;
  const scope = `${caseId}:${process || "current"}`,
    previousScope = useRef(scope);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (data.demo) {
      setSnapshot((previous) =>
        previous?.caseId === caseId ? previous : demoSnapshot(data, caseId),
      );
      return;
    }
    if (previousScope.current !== scope) setSnapshot(null);
    previousScope.current = scope;
    void fetch(
      `/api/pipeline-os/case-flow?${new URLSearchParams({ case: caseId, ...(process ? { process } : {}) })}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        if (value.caseId !== caseId)
          throw new Error("Expediente no disponible / Case unavailable");
        if (!controller.signal.aborted) setSnapshot(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [caseId, data.demo, process, revision]);
  async function save(command: CaseFlowInput, form?: HTMLFormElement) {
    if (busy || !snapshot?.canManage) return false;
    setBusy(true);
    setError("");
    const text = JSON.stringify({ caseId, command });
    if (key.current?.text !== text)
      key.current = { text, key: crypto.randomUUID() };
    try {
      if (data.demo) {
        const p = command as Extract<CaseFlowCommand, { operation: "lender" }>;
        if (p.operation === "lender")
          setSnapshot(
            (previous) =>
              previous && {
                ...previous,
                lenders: previous.lenders.map((l) =>
                  l.id === p.lender_id
                    ? {
                        ...l,
                        offered_amount:
                          p.state === "offer"
                            ? p.offered_amount
                            : l.offered_amount,
                        selected: p.state === "selected" ? true : l.selected,
                        requirements_state:
                          p.state === "requirements_pending"
                            ? "pending"
                            : p.state === "requirements_resolved"
                              ? "resolved"
                              : l.requirements_state,
                        agreed_amount:
                          p.state === "agreed_amount"
                            ? p.agreed_amount
                            : l.agreed_amount,
                      }
                    : p.state === "selected"
                      ? { ...l, selected: false }
                      : l,
                ),
              },
          );
      } else {
        const response = await fetch("/api/pipeline-os/case-flow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: caseId,
            command: { ...command, request_key: key.current.key },
          }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        if (context.current !== caseId) return false;
        await changed();
        setRevision((v) => v + 1);
      }
      if (form) markFormSaved(form);
      key.current = null;
      return true;
    } catch (e) {
      if (context.current === caseId) setError((e as Error).message);
      return false;
    } finally {
      if (context.current === caseId) setBusy(false);
    }
  }
  return {
    snapshot,
    error,
    busy,
    save,
    retry: () => setRevision((v) => v + 1),
  };
}
function EvidenceFields({
  snapshot,
  locale,
}: {
  snapshot: FlowSnapshot;
  locale: Locale;
}) {
  return (
    <>
      <label className="field">
        {t(locale, "Motivo / hecho confirmado", "Reason / confirmed fact")}
        <textarea name="reason" required maxLength={2000} rows={2} />
      </label>
      <label className="field">
        {t(
          locale,
          "Correo o documento de respaldo",
          "Supporting email or document",
        )}
        <select name="evidence" required defaultValue="">
          <option value="">
            {t(
              locale,
              "Elegir respaldo del expediente",
              "Select case evidence",
            )}
          </option>
          {snapshot.evidence.map((e) => (
            <option key={`${e.type}:${e.id}`} value={`${e.type}:${e.id}`}>
              {e.type === "mail" ? "✉ " : "▤ "}
              {e.label}
            </option>
          ))}
        </select>
      </label>
      {!snapshot.evidence.length && (
        <p role="status">
          {t(
            locale,
            "Primero incorpora un correo o documento al expediente para respaldar el cambio.",
            "First incorporate an email or document into this case to support the change.",
          )}
        </p>
      )}
    </>
  );
}
function evidence(form: FormData) {
  const [kind, id] = String(form.get("evidence") || "").split(":");
  return {
    reason: String(form.get("reason") || ""),
    archive_message_id: kind === "mail" ? id : null,
    document_id: kind === "document" ? id : null,
  };
}
function FlowNotice({
  error,
  retry,
  locale,
}: {
  error: string;
  retry(): void;
  locale: Locale;
}) {
  return (
    <div role="alert" className="error-banner">
      <p>{error}</p>
      <button type="button" className="button" onClick={retry}>
        {t(locale, "Actualizar estado", "Refresh state")}
      </button>
    </div>
  );
}

export function LenderFlowPanel({
  data,
  caseId,
  locale,
  lenderIds = [],
  conversationId = null,
  changed,
}: {
  data: Workspace;
  caseId: string;
  locale: Locale;
  lenderIds?: string[];
  conversationId?: string | null;
  changed(): Promise<void>;
}) {
  const { requestLeave, confirmation } = useLeaveConfirmation(locale);
  const [process, setProcess] = useState<string | null>(null),
    [lenderId, setLenderId] = useState(lenderIds[0] || "");
  const [state, setState] = useState<
    | "offer"
    | "selected"
    | "requirements_pending"
    | "requirements_resolved"
    | "agreed_amount"
  >("offer");
  const [notice, setNotice] = useState("");
  const flow = useFlow(data, caseId, process, changed),
    snapshot = flow.snapshot;
  const selectedId = lenderIds.length === 1 ? lenderIds[0] : lenderId;
  const lender = snapshot?.lenders.find((l) => l.id === selectedId);
  const selectedProcess = snapshot?.processes.find(
    (p) => p.id === (process || snapshot.processId),
  );
  const closed = ["disbursed", "client_withdrew", "funding_declined"].includes(
    selectedProcess?.state || "",
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!snapshot || !lender) return;
    const form = e.currentTarget,
      values = new FormData(form);
    const prior = snapshot.events
      .filter(
        (e) =>
          e.process_id === snapshot.processId && e.kind === "workflow_lender",
      )
      .sort(
        (a, b) =>
          (b.created_at || b.occurred_at).localeCompare(
            a.created_at || a.occurred_at,
          ) || b.id.localeCompare(a.id),
      )[0];
    const saved = await flow.save(
      {
        operation: "lender",
        process_id: snapshot.processId,
        expected_event_id: prior?.id || null,
        lender_id: lender.id,
        conversation_id: conversationId,
        state,
        offered_amount: values.get("offered_amount")
          ? Number(values.get("offered_amount"))
          : null,
        agreed_amount: values.get("agreed_amount")
          ? Number(values.get("agreed_amount"))
          : null,
        ...evidence(values),
      } as Omit<
        Extract<CaseFlowCommand, { operation: "lender" }>,
        "request_key"
      >,
      form,
    );
    if (saved)
      setNotice(
        t(
          locale,
          "Cambio guardado con respaldo. Las otras ofertas se conservan.",
          "Change saved with evidence. Other offers are kept.",
        ),
      );
  }
  return (
    <details className="case-lender-flow" open={!!conversationId}>
      {confirmation}
      <summary>
        {t(locale, "Gestión del lender", "Lender management")}
        {lender && <> · {lender.name}</>}
      </summary>
      {flow.error && (
        <FlowNotice error={flow.error} retry={flow.retry} locale={locale} />
      )}
      {!snapshot && !flow.error && (
        <p role="status">
          {t(locale, "Cargando estado del lender…", "Loading lender status…")}
        </p>
      )}
      {snapshot && (
        <>
          {!snapshot.canManage && (
            <p>
              {t(
                locale,
                "Solo el responsable actual y los administradores pueden modificar esta gestión.",
                "Only the current case owner and administrators can modify this workflow.",
              )}
            </p>
          )}
          {snapshot.processes.length > 1 && (
            <label className="field">
              {t(locale, "Operación", "Operation")}
              <select
                value={process || snapshot.processId || ""}
                disabled={flow.busy}
                onChange={(e) => {
                  const value = e.target.value;
                  requestLeave(() => setProcess(value || null));
                }}
              >
                <option value="">
                  {t(locale, "Operación actual", "Current operation")}
                </option>
                {snapshot.processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sequence_number} · {p.classification}
                  </option>
                ))}
              </select>
            </label>
          )}
          {lenderIds.length !== 1 && (
            <label className="field">
              Lender
              <select
                value={lenderId}
                onChange={(e) => {
                  const value = e.target.value;
                  requestLeave(() => {
                    setLenderId(value);
                    setNotice("");
                  });
                }}
                disabled={flow.busy}
              >
                <option value="">
                  {t(locale, "Selecciona un lender", "Select a lender")}
                </option>
                {snapshot.lenders
                  .filter((l) => !lenderIds.length || lenderIds.includes(l.id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.selected ? " · ✓" : ""}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {lender && (
            <>
              <dl className="case-lender-facts">
                <div>
                  <dt>{t(locale, "Oferta", "Offer")}</dt>
                  <dd>
                    {lender.offered_amount
                      ? currency(lender.offered_amount, locale)
                      : t(locale, "Pendiente", "Pending")}
                  </dd>
                </div>
                <div>
                  <dt>{t(locale, "Selección", "Selection")}</dt>
                  <dd>
                    {lender.selected
                      ? t(locale, "Lender seleccionado", "Selected lender")
                      : !lender.offered_amount
                        ? t(
                            locale,
                            "Sin oferta registrada",
                            "No offer recorded",
                          )
                        : t(
                            locale,
                            "Alternativa disponible",
                            "Available alternative",
                          )}
                  </dd>
                </div>
                <div>
                  <dt>{t(locale, "Requisitos", "Requirements")}</dt>
                  <dd>
                    {lender.requirements_state === "pending"
                      ? t(locale, "Pendientes", "Pending")
                      : lender.requirements_state === "resolved"
                        ? t(locale, "Resueltos", "Resolved")
                        : t(
                            locale,
                            "Sin requisitos registrados",
                            "No requirements recorded",
                          )}
                  </dd>
                </div>
                <div>
                  <dt>
                    {t(locale, "Monto final acordado", "Final agreed amount")}
                  </dt>
                  <dd>
                    {lender.agreed_amount
                      ? currency(lender.agreed_amount, locale)
                      : "—"}
                  </dd>
                </div>
              </dl>
              {closed && (
                <p>
                  {t(
                    locale,
                    "Operación cerrada. Consulta el histórico o inicia una nueva operación para una renovación.",
                    "Closed operation. Review history or start a new operation for a renewal.",
                  )}
                </p>
              )}
              {snapshot.canManage && !closed && (
                <ProtectedForm busy={flow.busy} onSubmit={submit}>
                  <label className="field">
                    {t(locale, "Registrar", "Record")}
                    <select
                      value={state}
                      disabled={flow.busy}
                      onChange={(e) => {
                        setState(e.target.value as typeof state);
                        setNotice("");
                      }}
                    >
                      <option value="offer">
                        {t(
                          locale,
                          "Oferta recibida / disponible para negociar",
                          "Offer received / available to negotiate",
                        )}
                      </option>
                      <option value="selected">
                        {t(
                          locale,
                          "Seleccionar este lender",
                          "Select this lender",
                        )}
                      </option>
                      <option value="requirements_pending">
                        {t(
                          locale,
                          "Requisitos pendientes",
                          "Pending requirements",
                        )}
                      </option>
                      <option value="requirements_resolved">
                        {t(
                          locale,
                          "Requisitos resueltos",
                          "Resolved requirements",
                        )}
                      </option>
                      <option value="agreed_amount">
                        {t(
                          locale,
                          "Monto final del crédito acordado",
                          "Final agreed credit amount",
                        )}
                      </option>
                    </select>
                  </label>
                  {state === "offer" && (
                    <label className="field">
                      {t(
                        locale,
                        "Monto ofrecido por este lender (USD)",
                        "Amount offered by this lender (USD)",
                      )}
                      <input
                        key={lender.id}
                        type="number"
                        name="offered_amount"
                        min="0.01"
                        max="1000000000000"
                        step="0.01"
                        required
                        defaultValue={lender.offered_amount || ""}
                      />
                    </label>
                  )}
                  {state === "agreed_amount" && (
                    <>
                      <label className="field">
                        {t(
                          locale,
                          "Monto final acordado (USD)",
                          "Final agreed amount (USD)",
                        )}
                        <input
                          key={lender.id}
                          type="number"
                          name="agreed_amount"
                          min="0.01"
                          max="1000000000000"
                          step="0.01"
                          required
                          defaultValue={lender.agreed_amount || ""}
                        />
                      </label>
                      <p className="muted">
                        {t(
                          locale,
                          "Solo para el lender elegido. Este importe no registra un desembolso.",
                          "For the selected lender only. This amount does not record funding.",
                        )}
                      </p>
                    </>
                  )}
                  <EvidenceFields snapshot={snapshot} locale={locale} />
                  <button
                    className="button primary"
                    disabled={
                      flow.busy ||
                      !snapshot.evidence.length ||
                      (state === "agreed_amount" && !lender.selected)
                    }
                  >
                    {flow.busy
                      ? t(locale, "Guardando…", "Saving…")
                      : t(locale, "Guardar cambio", "Save change")}
                  </button>
                </ProtectedForm>
              )}
            </>
          )}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </details>
  );
}

export function CaseFlowManualDialog({
  data,
  caseId,
  milestone,
  title,
  locale,
  changed,
  close,
}: {
  data: Workspace;
  caseId: string;
  milestone: string;
  title: string;
  locale: Locale;
  changed(): Promise<void>;
  close(): void;
}) {
  const flow = useFlow(data, caseId, null, changed),
    snapshot = flow.snapshot;
  const closingStates: Record<
    string,
    "contract_sent" | "contract_signed" | "final_approval" | "disbursed"
  > = {
    "contract-sent": "contract_sent",
    "contract-signed": "contract_signed",
    "final-approval": "final_approval",
    funding: "disbursed",
  };
  const [decision, setDecision] = useState<
    "confirmed" | "pending" | "automatic"
  >("confirmed");
  const isFunding = milestone === "funding",
    closing = closingStates[milestone];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!snapshot) return;
    const form = e.currentTarget,
      values = new FormData(form);
    const common = { process_id: snapshot.processId, ...evidence(values) };
    const command =
      closing && decision === "confirmed"
        ? {
            ...common,
            operation: "closing" as const,
            state: closing,
            funded_amount: isFunding
              ? Number(values.get("funded_amount"))
              : null,
            lender_id: isFunding ? String(values.get("lender_id")) : null,
          }
        : {
            ...common,
            operation: "confirmation" as const,
            milestone,
            decision,
            expected_event_id:
              latestConfirmation(
                snapshot.events,
                caseId,
                milestone,
                snapshot.processId,
              )?.id || null,
          };
    if (await flow.save(command as CaseFlowInput, form)) close();
  }
  return (
    <Modal title={title} locale={locale} busy={flow.busy} close={close}>
      {flow.error && (
        <FlowNotice error={flow.error} retry={flow.retry} locale={locale} />
      )}
      {!snapshot && !flow.error && (
        <p role="status">
          {t(locale, "Cargando evidencia…", "Loading evidence…")}
        </p>
      )}
      {snapshot?.canManage && (
        <ProtectedForm busy={flow.busy} onSubmit={submit}>
          {!isFunding && (
            <label className="field">
              {t(locale, "Revisión", "Review")}
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as typeof decision)}
              >
                <option value="confirmed">
                  {t(
                    locale,
                    "Confirmar con evidencia",
                    "Confirm with evidence",
                  )}
                </option>
                <option value="pending">
                  {t(locale, "Marcar como pendiente", "Mark pending")}
                </option>
                <option value="automatic">
                  {t(
                    locale,
                    "Volver al cálculo automático",
                    "Return to automatic calculation",
                  )}
                </option>
              </select>
            </label>
          )}
          {isFunding && (
            <>
              <label className="field">
                {t(
                  locale,
                  "Importe realmente desembolsado (USD)",
                  "Actual funded amount (USD)",
                )}
                <input
                  type="number"
                  name="funded_amount"
                  min="0.01"
                  max="1000000000000"
                  step="0.01"
                  required
                />
              </label>
              <label className="field">
                Lender
                <select
                  name="lender_id"
                  required
                  defaultValue={
                    snapshot.lenders.find((l) => l.selected)?.id || ""
                  }
                >
                  <option value="">
                    {t(locale, "Selecciona el lender", "Select lender")}
                  </option>
                  {snapshot.lenders.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <EvidenceFields snapshot={snapshot} locale={locale} />
          <button
            className="button primary"
            disabled={flow.busy || !snapshot.evidence.length}
          >
            {t(locale, "Guardar revisión", "Save review")}
          </button>
        </ProtectedForm>
      )}
      {snapshot && !snapshot.canManage && (
        <p>
          {t(
            locale,
            "No tienes permiso para modificar este expediente.",
            "You cannot modify this case.",
          )}
        </p>
      )}
    </Modal>
  );
}
