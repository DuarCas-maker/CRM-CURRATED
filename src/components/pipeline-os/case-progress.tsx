"use client";
import { useEffect, useId, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  HelpCircle,
  ListChecks,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import type { Locale, Workspace } from "@/lib/domain";
import {
  buildCaseProgress,
  type CaseProgress,
  type CaseProgressAction,
  type ProgressProcess,
  type ProgressState,
  type ProgressText,
} from "@/lib/pipeline-os/case-progress";
import { t } from "../ui";
import "./case-progress.css";

function StateIcon({ state }: { state: ProgressState }) {
  const Icon =
    state === "complete"
      ? Check
      : state === "restricted"
        ? LockKeyhole
        : state === "unknown"
          ? HelpCircle
          : Circle;
  return <Icon size={17} aria-hidden="true" />;
}
const actionText: Record<CaseProgressAction, ProgressText> = {
  documents: ["Revisar documentos", "Review documents"],
  analysis: ["Revisar análisis", "Review analysis"],
  lenders: ["Gestionar lenders y ofertas", "Manage lenders and offers"],
  mail_history: ["Abrir gestión e histórico", "Open management and history"],
};
const stateText: Record<ProgressState, ProgressText> = {
  complete: ["Verificado", "Verified"],
  pending: ["Pendiente", "Pending"],
  unknown: ["Sin verificar", "Unverified"],
  restricted: ["Acceso restringido", "Restricted access"],
};

export function CaseProgressPanel({
  progress,
  locale,
  open,
}: {
  progress: CaseProgress;
  locale: Locale;
  open(section: CaseProgressAction): void;
}) {
  const text = (value: ProgressText) => value[locale === "es" ? 0 : 1];
  const firstPending = progress.phases.find(
    (p) => !["complete", "restricted"].includes(p.state),
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const selected =
    progress.phases.find((p) => p.id === chosen) ||
    (progress.outcome === "without_funding"
      ? progress.phases.find((p) => p.id === "closing")
      : null) ||
    firstPending ||
    [...progress.phases].reverse().find((p) => p.state !== "restricted")!;
  const next = selected.items.find((i) => i.state !== "complete" && i.action);
  const complete = progress.phases.filter((p) => p.state === "complete").length;
  const visible = progress.phases.filter(
    (p) => p.state !== "restricted",
  ).length;
  const headingId = useId(),
    detailId = useId();
  const stepId = (id: string) => `${detailId}-${id}`;
  return (
    <section className="pos-case-progress" aria-labelledby={headingId}>
      <header className="pos-progress-heading">
        <div>
          <p className="pos-progress-eyebrow">
            <ListChecks size={16} aria-hidden="true" />
            {t(locale, "Paso a paso", "Step by step")}
          </p>
          <h2 id={headingId}>
            {t(locale, "Seguimiento del expediente", "Case progress")}
          </h2>
          <p className="pos-progress-description">
            {firstPending && progress.outcome === "open"
              ? t(
                  locale,
                  `Por completar: ${text(firstPending.title)}. Abre sus pendientes para continuar.`,
                  `To complete: ${text(firstPending.title)}. Open its pending items to continue.`,
                )
              : t(
                  locale,
                  "Lo completado y lo que falta para avanzar.",
                  "What is complete and what is needed to move forward.",
                )}
          </p>
        </div>
        <span className="pos-progress-total">
          {complete} / {visible}
          <small>
            {visible < progress.phases.length
              ? t(
                  locale,
                  "pasos visibles verificados",
                  "visible steps verified",
                )
              : t(locale, "pasos verificados", "steps verified")}
          </small>
        </span>
      </header>
      <div className="pos-progress-context">
        <span>
          {t(
            locale,
            "Documentos y análisis: expediente",
            "Documents and analysis: case",
          )}
        </span>
        <span>
          {!progress.closerVisible
            ? t(
                locale,
                "Lenders y cierre: equipo de closers",
                "Lenders and closing: closer team",
              )
            : progress.processNumber === null
              ? t(
                  locale,
                  "Sin proceso activo asociado",
                  "No linked active process",
                )
              : t(
                  locale,
                  `Lenders y cierre: proceso ${progress.processNumber}`,
                  `Lenders and closing: process ${progress.processNumber}`,
                )}
        </span>
      </div>
      {progress.multipleActive && (
        <p className="pos-progress-notice">
          {t(
            locale,
            "Hay varios procesos activos. Se muestra el más reciente; revisa sus asociaciones en el histórico.",
            "Several processes are active. The latest is shown; review its links in history.",
          )}
        </p>
      )}
      {progress.outcome !== "open" && (
        <p className={`pos-progress-outcome ${progress.outcome}`}>
          {progress.outcome === "funded"
            ? t(
                locale,
                "Desembolso registrado en este proceso.",
                "Funding recorded in this process.",
              )
            : t(
                locale,
                "Cerrado sin financiación: rechazo o retiro registrado. Los puntos sin evidencia se conservan para revisión.",
                "Closed without funding: a decline or withdrawal is recorded. Items without evidence remain available for review.",
              )}
        </p>
      )}
      <ol
        className="pos-progress-steps"
        aria-label={t(locale, "Recorrido del expediente", "Case journey")}
      >
        {progress.phases.map((phase, index) => (
          <li key={phase.id} data-state={phase.state}>
            <button
              type="button"
              id={stepId(phase.id)}
              className={selected.id === phase.id ? "is-selected" : ""}
              aria-expanded={selected.id === phase.id}
              aria-controls={detailId}
              aria-current={firstPending?.id === phase.id ? "step" : undefined}
              onClick={() => setChosen(phase.id)}
            >
              <span className="pos-progress-number">
                {phase.state === "complete" ? (
                  <Check size={17} aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span>
                <strong>{text(phase.title)}</strong>
                <small>{text(stateText[phase.state])}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div
        id={detailId}
        role="region"
        aria-labelledby={stepId(selected.id)}
        className="pos-progress-detail"
      >
        <div className="pos-progress-detail-heading">
          <h3>{text(selected.title)}</h3>
          <span>
            {["unknown", "restricted"].includes(selected.state) ? (
              text(stateText[selected.state])
            ) : (
              <>
                {selected.items.filter((i) => i.state === "complete").length} /{" "}
                {selected.items.length}
              </>
            )}
          </span>
        </div>
        <ul className="pos-progress-items">
          {selected.items.map((item) => (
            <li key={item.id} data-state={item.state}>
              <span className="pos-progress-item-icon">
                <StateIcon state={item.state} />
              </span>
              <div>
                <strong>{text(item.title)}</strong>
                <p>{text(item.detail)}</p>
              </div>
              <span className="pos-progress-item-state">
                {text(stateText[item.state])}
              </span>
              {item.state !== "complete" && item.action && (
                <button
                  type="button"
                  className="pos-progress-link"
                  onClick={() => open(item.action!)}
                >
                  {text(actionText[item.action])}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <footer className="pos-progress-footer">
          <p>
            {t(
              locale,
              "Se calcula con los registros del CRM. No necesitas marcar casillas.",
              "Calculated from CRM records. No manual checkboxes needed.",
            )}
          </p>
          {progress.outcome === "without_funding" && progress.closerVisible ? (
            <button
              type="button"
              className="pos-btn pos-primary"
              onClick={() => open("mail_history")}
            >
              {t(locale, "Revisar cierre", "Review closing")}
              <ArrowUpRight size={15} />
            </button>
          ) : next?.action ? (
            <button
              type="button"
              className="pos-btn pos-primary"
              onClick={() => open(next.action!)}
            >
              {text(actionText[next.action])}
              <ArrowUpRight size={15} />
            </button>
          ) : null}
        </footer>
      </div>
    </section>
  );
}

export function PipelineCaseProgress({
  data,
  caseId,
  processes,
  locale,
  open,
}: {
  data: Workspace;
  caseId: string;
  processes: ProgressProcess[];
  locale: Locale;
  open(section: CaseProgressAction): void;
}) {
  const [loaded, setLoaded] = useState<{
    caseId: string;
    progress: CaseProgress;
  } | null>(null);
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (data.demo) return;
    const controller = new AbortController();
    setLoaded(null);
    setFailed(false);
    void fetch(
      `/api/pipeline-os/case-progress?${new URLSearchParams({ case: caseId })}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("CASE_PROGRESS_UNAVAILABLE");
        const progress = (await response.json()) as CaseProgress;
        if (progress.caseId !== caseId || progress.phases?.length !== 5)
          throw new Error("CASE_PROGRESS_INVALID");
        if (!controller.signal.aborted) setLoaded({ caseId, progress });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [caseId, data, retry]);
  const opportunity = data.opportunities.find((o) => o.id === caseId);
  const progress =
    data.demo && opportunity
      ? buildCaseProgress({ ...data, opportunity, processes, events: [] })
      : loaded?.caseId === caseId
        ? loaded.progress
        : null;
  if (!progress)
    return (
      <section
        className="pos-case-progress pos-progress-loading"
        aria-label={t(locale, "Seguimiento del expediente", "Case progress")}
        aria-busy={!failed}
      >
        <h2>{t(locale, "Seguimiento del expediente", "Case progress")}</h2>
        {failed ? (
          <>
            <p role="alert">
              {t(
                locale,
                "No se pudo verificar el seguimiento. Actualiza para consultar la evidencia; las acciones del expediente siguen disponibles debajo.",
                "Progress could not be verified. Refresh to check evidence; case actions remain available below.",
              )}
            </p>
            <button
              type="button"
              className="pos-btn"
              onClick={() => setRetry((n) => n + 1)}
            >
              <RefreshCw size={15} />
              {t(locale, "Reintentar", "Retry")}
            </button>
          </>
        ) : (
          <p role="status">
            {t(
              locale,
              "Comprobando documentos, análisis y proceso…",
              "Checking documents, analysis and process…",
            )}
          </p>
        )}
      </section>
    );
  return (
    <CaseProgressPanel
      key={caseId}
      progress={progress}
      locale={locale}
      open={open}
    />
  );
}
