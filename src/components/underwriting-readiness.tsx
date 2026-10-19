"use client";
import { Check, X, LoaderCircle } from "lucide-react";
import type { Document, Locale } from "@/lib/domain";
import type { UnderwritingRun } from "@/lib/underwriting";
import {
  underwritingReadiness,
  underwritingProgress,
  underwritingError,
} from "@/lib/underwriting-status";
import { t } from "./ui";

export function UnderwritingChecklist({
  documents,
  locale,
  demo = false,
  openDocuments,
}: {
  documents: Document[];
  locale: Locale;
  demo?: boolean;
  openDocuments?: () => void;
}) {
  const state = underwritingReadiness(documents, demo);
  const reason = (doc?: Document, duplicate = false) =>
    !doc
      ? t(
          locale,
          "Falta incorporar y aprobar el archivo",
          "Add and approve the file",
        )
      : duplicate
        ? t(
            locale,
            "Archivo duplicado; necesitas un extracto diferente",
            "Duplicate file; a different statement is required",
          )
        : doc.status === "correction"
          ? t(
              locale,
              "Requiere corrección y nueva revisión",
              "Needs correction and another review",
            )
          : doc.status !== "approved"
            ? doc.storage_path || demo
              ? t(
                  locale,
                  "Archivo pendiente de aprobación",
                  "File awaiting approval",
                )
              : t(
                  locale,
                  "Falta incorporar y aprobar el archivo",
                  "Add and approve the file",
                )
            : !state.usable(doc)
              ? t(
                  locale,
                  "Aprobado sin archivo válido; vuelve a incorporar y revisar",
                  "Approved without a valid file; add and review it again",
                )
              : t(locale, "Aprobado y listo", "Approved and ready");
  const rows = state.required.map((doc) => ({
    id: doc.id,
    label:
      doc.kind === "application"
        ? t(locale, "Solicitud / aplicación", "Application")
        : doc.name,
    ready: state.usable(doc),
    reason: reason(doc),
  }));
  if (
    !rows.some(
      (r) => documents.find((d) => d.id === r.id)?.kind === "application",
    )
  ) {
    const doc =
      documents.find((d) => d.kind === "application" && state.usable(d)) ||
      documents.find((d) => d.kind === "application");
    rows.unshift({
      id: "application",
      label: t(locale, "Solicitud / aplicación", "Application"),
      ready: state.applicationReady,
      reason: reason(doc),
    });
  }
  rows.push(
    ...state.bankRows.map((row) => ({
      id: row.id,
      label: `${t(locale, "Extracto bancario", "Bank statement")} ${row.number}${row.doc.bank_name ? ` · ${row.doc.bank_name}` : ""}`,
      ready: row.ready,
      reason: reason(row.doc, row.duplicate),
    })),
  );
  for (let i = state.bankRows.length; i < 4; i++)
    rows.push({
      id: `missing-bank-${i}`,
      label: `${t(locale, "Extracto bancario", "Bank statement")} ${i + 1}`,
      ready: false,
      reason: reason(),
    });
  return (
    <section
      className="underwriting-checklist"
      aria-label={t(
        locale,
        "Checklist para analizar documentos",
        "Analysis document checklist",
      )}
    >
      <div className="split-heading">
        <h3>{t(locale, "Antes de analizar", "Before analyzing")}</h3>
        <span
          className={`underwriting-readiness-summary ${state.ready ? "is-ready" : "is-missing"}`}
        >
          {state.ready ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <X size={16} aria-hidden="true" />
          )}
          {state.ready
            ? t(locale, "Documentación lista", "Documents ready")
            : t(locale, "Faltan requisitos", "Missing requirements")}
        </span>
      </div>
      <p>
        {t(
          locale,
          `${state.approvedBanks} de 4 extractos aprobados y distintos como mínimo.`,
          `${state.approvedBanks} of at least 4 distinct, approved statements.`,
        )}
      </p>
      <ul className="underwriting-checklist-items">
        {rows.map((row) => (
          <li key={row.id} className={row.ready ? "is-ready" : "is-missing"}>
            <span
              className="underwriting-check-icon"
              aria-label={
                row.ready
                  ? t(locale, "Cumplido", "Ready")
                  : t(locale, "Pendiente", "Pending")
              }
            >
              {row.ready ? <Check size={19} /> : <X size={19} />}
            </span>
            <span>
              <strong>{row.label}</strong>
              <small>{row.reason}</small>
            </span>
          </li>
        ))}
      </ul>
      {!state.sourcesWithinLimit && (
        <p role="alert">
          {t(
            locale,
            `Hay ${state.sourceCount} archivos aprobados; el máximo por análisis es 24.`,
            `There are ${state.sourceCount} approved files; the maximum per analysis is 24.`,
          )}
        </p>
      )}
      <p className="muted">
        {t(
          locale,
          "Se incluyen todos los extractos aprobados de cada banco. Los extractos adicionales sin aprobar no se incluyen ni bloquean cuando ya tienes cuatro distintos aprobados.",
          "Every approved statement from each bank is included. Unapproved additional statements are excluded and do not block analysis once four distinct statements are approved.",
        )}
      </p>
      {openDocuments && (
        <button className="button" type="button" onClick={openDocuments}>
          {t(
            locale,
            "Revisar documentos pendientes",
            "Review pending documents",
          )}
        </button>
      )}
    </section>
  );
}

export function UnderwritingProgressBar({
  run,
  locale,
}: {
  run: UnderwritingRun;
  locale: Locale;
}) {
  const state = underwritingProgress(run, locale);
  return (
    <section
      className={`underwriting-progress ${state.stopped ? "is-stopped" : ""}`}
      aria-label={t(locale, "Avance del análisis", "Analysis progress")}
    >
      <div className="split-heading">
        <strong role="status">
          {state.active && (
            <LoaderCircle
              className="underwriting-spinner"
              size={17}
              aria-hidden="true"
            />
          )}
          {state.label}
        </strong>
        <span>{state.percent}%</span>
      </div>
      <div
        className="underwriting-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state.percent}
        aria-valuetext={`${state.percent}% · ${state.label}`}
        aria-label={t(locale, "Avance por etapas", "Stage progress")}
      >
        <div
          className={`underwriting-progress-fill ${state.active ? "is-active" : ""}`}
          style={{ width: `${state.percent}%` }}
        />
      </div>
      {state.stage === "documents" && (
        <p>
          {t(
            locale,
            `${state.processed} de ${state.total} archivos preparados`,
            `${state.processed} of ${state.total} files prepared`,
          )}
        </p>
      )}
      {state.active && (
        <p className="muted">
          {t(
            locale,
            "Avance por etapas. Durante la consulta a OpenAI, la barra espera la respuesta; no es un porcentaje de lectura interna ni un tiempo estimado.",
            "Stage progress. While OpenAI is working, the bar waits for its response; it is not an internal reading percentage or a time estimate.",
          )}
        </p>
      )}
      {state.complete && run.status === "draft" && (
        <p>
          {t(
            locale,
            "100%: borrador guardado. Falta la revisión del equipo.",
            "100%: draft saved. Team review remains.",
          )}
        </p>
      )}
    </section>
  );
}

export function UnderwritingFailure({
  run,
  locale,
}: {
  run: UnderwritingRun;
  locale: Locale;
}) {
  if (!run.last_error) return null;
  const error = underwritingError(run.last_error, locale);
  const limit =
    run.provider_diagnostics?.max_output_tokens ?? run.max_output_tokens;
  return (
    <div className="underwriting-failure" role="alert">
      <strong>{error.message}</strong>
      <p>{error.action}</p>
      {!!limit && (
        <small>
          {t(locale, "Límite de esta ejecución", "This run's token limit")}:{" "}
          {limit.toLocaleString(locale)}
        </small>
      )}
      {run.output_tokens != null && (
        <small>
          {t(locale, "Tokens de salida utilizados", "Output tokens used")}:{" "}
          {run.output_tokens.toLocaleString(locale)}
        </small>
      )}
      <details>
        <summary>{t(locale, "Detalle técnico", "Technical details")}</summary>
        <code>{run.last_error}</code>
      </details>
    </div>
  );
}
