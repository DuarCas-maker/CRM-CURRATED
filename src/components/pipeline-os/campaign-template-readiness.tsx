import type { Locale } from "@/lib/domain";
import {
  missingFieldLabel,
  type TemplateReadiness,
} from "@/lib/campaign-readiness";
import { audienceReasons } from "@/lib/campaign-delivery";
import { t } from "../ui";
export function CampaignTemplateReadiness({
  review,
  error,
  retry,
  locale,
}: {
  review?: TemplateReadiness;
  error?: string;
  retry: () => void;
  locale: Locale;
}) {
  return (
    <section
      className="cf-data-review"
      aria-label={t(locale, "Revisión de datos del lote", "Batch data review")}
      aria-live="polite"
    >
      <strong>{t(locale, "Datos reales del lote", "Actual batch data")}</strong>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button className="pos-btn" type="button" onClick={retry}>
            {t(locale, "Revisar otra vez", "Check again")}
          </button>
        </p>
      ) : !review ? (
        <p role="status">
          {t(locale, "Revisando datos de los leads…", "Checking lead data…")}
        </p>
      ) : (
        <>
          <p>
            {review.checked_count} {t(locale, "revisados", "checked")} ·{" "}
            <b>
              {review.ready_count}{" "}
              {t(
                locale,
                "listos para esta plantilla",
                "ready for this template",
              )}
            </b>{" "}
            · {review.attention_count}{" "}
            {t(locale, "por revisar", "need attention")}
          </p>
          {review.attention_count > 0 && (
            <details open>
              <summary>
                {t(
                  locale,
                  "Ver leads y datos pendientes",
                  "View leads and missing data",
                )}{" "}
                ({review.attention_count})
              </summary>
              <ul
                className="cf-missing-list"
                tabIndex={0}
                aria-label={t(
                  locale,
                  "Leads con datos pendientes",
                  "Leads needing attention",
                )}
              >
                {review.rows
                  .filter((row) => !row.ready)
                  .map((row) => (
                    <li key={row.contact_id}>
                      <strong>{row.company || row.name || row.email}</strong>
                      <span>{row.email}</span>
                      <span>
                        {row.missing_fields.length
                          ? `${t(locale, "Falta", "Missing")}: ${row.missing_fields.map((field) => missingFieldLabel(field, locale)).join(", ")}`
                          : audienceReasons[row.reason]?.[
                              locale === "es" ? 0 : 1
                            ] ||
                            t(
                              locale,
                              "Revisa la disponibilidad de este lead",
                              "Review this lead's availability",
                            )}
                      </span>
                    </li>
                  ))}
              </ul>
              <p>
                {t(
                  locale,
                  "Tu selección se conserva. Vuelve al lote para filtrar o completa los datos; también puedes elegir otra plantilla.",
                  "Your selection is unchanged. Return to the batch to filter, complete the data, or choose another template.",
                )}
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
