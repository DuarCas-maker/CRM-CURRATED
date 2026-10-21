"use client";

import { CircleCheck, Clock3, AlertCircle, RefreshCw } from "lucide-react";
import type { Locale } from "@/lib/domain";
import {
  verificationProgress,
  verificationBatchStatus,
  type VerificationBatch,
} from "@/lib/lead-preparation";
import { Empty, t } from "./ui";

export function LeadDate({
  value,
  locale,
  elapsed = false,
}: {
  value?: string | null;
  locale: Locale;
  elapsed?: boolean;
}) {
  if (!value)
    return (
      <span className="muted">{t(locale, "Sin registro", "Not recorded")}</span>
    );
  const hours = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 3600000),
  );
  const age =
    hours < 1
      ? t(locale, "Hace menos de 1 h", "Less than 1h ago")
      : hours < 24
        ? t(locale, `Hace ${hours} h`, `${hours}h ago`)
        : t(
            locale,
            `Hace ${Math.floor(hours / 24)} días`,
            `${Math.floor(hours / 24)} days ago`,
          );
  return (
    <span className="lead-date">
      <time
        dateTime={value}
        title={new Intl.DateTimeFormat(locale === "es" ? "es-CO" : "en-US", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: "America/Bogota",
        }).format(new Date(value))}
      >
        {new Intl.DateTimeFormat(locale === "es" ? "es-CO" : "en-US", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "America/Bogota",
        }).format(new Date(value))}
      </time>
      <small className="muted">
        {elapsed
          ? age
          : new Intl.DateTimeFormat(locale === "es" ? "es-CO" : "en-US", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Bogota",
            }).format(new Date(value))}
      </small>
    </span>
  );
}

export function LeadVerifications({
  batches,
  locale,
  loading,
  refresh,
}: {
  batches: VerificationBatch[];
  locale: Locale;
  loading: boolean;
  refresh: () => void;
}) {
  return (
    <section className="panel lead-panel" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h2>{t(locale, "Verificaciones", "Verifications")}</h2>
          <p className="muted">
            {t(
              locale,
              "Sigue cada solicitud: completados, pendientes y casos que necesitan revisión. Se actualiza automáticamente cada 15 segundos.",
              "Track each request: completed, pending, and cases needing review. Updates automatically every 15 seconds.",
            )}
          </p>
        </div>
        <button
          className="icon-button"
          onClick={refresh}
          disabled={loading}
          aria-label={t(
            locale,
            "Actualizar verificaciones",
            "Refresh verifications",
          )}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="lead-verification-list" aria-live="polite">
        {batches.map((batch) => {
          const status = verificationBatchStatus(batch);
          const percent = verificationProgress(batch);
          return (
            <article className="lead-verification-card" key={batch.id}>
              <div className="lead-verification-heading">
                <div>
                  <strong>
                    {t(
                      locale,
                      "Solicitud de verificación",
                      "Verification request",
                    )}{" "}
                    · {batch.id.slice(0, 8)}
                  </strong>
                  <LeadDate value={batch.started_at} locale={locale} elapsed />
                </div>
                <span className={`lead-verification-status ${status}`}>
                  {status === "completed" ? (
                    <CircleCheck size={16} />
                  ) : status === "review" ? (
                    <AlertCircle size={16} />
                  ) : (
                    <Clock3 size={16} />
                  )}
                  {status === "completed"
                    ? t(locale, "Completada", "Completed")
                    : status === "review"
                      ? t(locale, "Requiere revisión", "Needs review")
                      : t(locale, "En proceso", "In progress")}
                </span>
              </div>
              <div className="lead-progress-label">
                <strong>
                  {batch.completed.toLocaleString()} /{" "}
                  {batch.total.toLocaleString()}{" "}
                  {t(locale, "completados", "completed")}
                </strong>
                <span>{percent}%</span>
              </div>
              <div
                className="progress lead-progress"
                role="progressbar"
                aria-label={t(locale, "Leads verificados", "Verified leads")}
                aria-valuenow={batch.completed}
                aria-valuemin={0}
                aria-valuemax={batch.total}
                aria-valuetext={`${batch.completed} / ${batch.total}`}
              >
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="lead-verification-details">
                <span>
                  {batch.pending} {t(locale, "pendientes", "pending")}
                </span>
                <span>
                  {batch.valid} {t(locale, "válidos", "valid")}
                </span>
                <span>
                  {batch.invalid} {t(locale, "inválidos", "invalid")}
                </span>
                <span>
                  {batch.uncertain} {t(locale, "inciertos", "uncertain")}
                </span>
                {!!batch.errors && (
                  <span className="lead-review-text">
                    {batch.errors}{" "}
                    {t(locale, "errores técnicos", "technical errors")}
                  </span>
                )}
                {!!batch.review && (
                  <span className="lead-review-text">
                    {batch.review} {t(locale, "por revisar", "to review")}
                  </span>
                )}
              </div>
              {batch.completed_at && (
                <p className="muted lead-completed-date">
                  {t(locale, "Finalizada", "Finished")}{" "}
                  <LeadDate value={batch.completed_at} locale={locale} />
                </p>
              )}
            </article>
          );
        })}
        {!batches.length && (
          <Empty
            title={
              loading
                ? t(
                    locale,
                    "Cargando verificaciones…",
                    "Loading verifications…",
                  )
                : t(
                    locale,
                    "Todavía no hay verificaciones con estos filtros",
                    "No verifications match these filters yet",
                  )
            }
          />
        )}
      </div>
    </section>
  );
}
