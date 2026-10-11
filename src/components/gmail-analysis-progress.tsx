import type { Locale } from "@/lib/domain";
import {
  gmailAnalysisProgress,
  type GmailAnalysisCounts,
} from "@/lib/gmail-analysis-progress";
import { t } from "./ui";

export function GmailAnalysisProgress({
  run,
  locale,
}: {
  run: GmailAnalysisCounts & { imported: number };
  locale: Locale;
}) {
  const progress = gmailAnalysisProgress(run);
  const format = (value: number) =>
    value.toLocaleString(locale === "es" ? "es-CO" : "en-US");
  return (
    <>
      <strong>{run.status}</strong> · {format(progress.saved)}{" "}
      {t(locale, "mensajes guardados", "messages saved")} ·{" "}
      {format(run.imported)}{" "}
      {t(locale, "participantes incorporados", "participants imported")}
      <dl className="gmail-analysis-counts">
        <div>
          <dt>
            {progress.complete
              ? t(
                  locale,
                  "Total guardado del análisis",
                  "Final saved analysis total",
                )
              : t(locale, "Total estimado de Gmail", "Gmail estimated total")}
          </dt>
          <dd>
            {progress.complete
              ? format(progress.saved)
              : progress.estimate > 0
                ? `≈ ${format(progress.estimate)}`
                : t(locale, "No disponible", "Unavailable")}
          </dd>
        </div>
        <div>
          <dt>{t(locale, "Mensajes guardados", "Messages saved")}</dt>
          <dd>{format(progress.saved)}</dd>
        </div>
        <div>
          <dt>
            {progress.complete
              ? t(locale, "Pendientes de analizar", "Remaining to analyze")
              : t(locale, "Restantes estimados", "Estimated remaining")}
          </dt>
          <dd>
            {progress.remaining === null
              ? t(locale, "Por determinar", "To be determined")
              : `${progress.complete ? "" : "≈ "}${format(progress.remaining)}`}
          </dd>
        </div>
        <div>
          <dt>{t(locale, "Mensajes omitidos", "Messages skipped")}</dt>
          <dd>{format(progress.skipped)}</dd>
        </div>
      </dl>
      <div className="gmail-analysis-bar">
        <span>
          {progress.complete
            ? t(
                locale,
                "Lectura del análisis terminada",
                "Analysis scan finished",
              )
            : progress.percent === null
              ? t(
                  locale,
                  "Calculando el total del análisis",
                  "Determining analysis total",
                )
              : `${t(locale, "Avance aproximado", "Approximate progress")}: ${format(progress.percent)} %`}
        </span>
        <progress
          max={100}
          value={progress.percent ?? undefined}
          aria-label={t(
            locale,
            "Avance de lectura de Gmail",
            "Gmail scan progress",
          )}
        />
      </div>
      <p>
        {progress.complete
          ? t(
              locale,
              "Este es el total guardado del análisis. La incorporación a expedientes depende de los candidatos que confirmes; terminar la lectura no confirma la importación.",
              "This is the saved analysis total. Import into cases depends on the candidates you confirm; finishing the scan does not approve the import.",
            )
          : progress.exceeded
            ? t(
                locale,
                "La lectura ya alcanzó o superó la estimación de Gmail. El análisis sigue en curso; el porcentaje y los restantes quedan pendientes hasta conocer el total.",
                "The scan has reached or exceeded Gmail's estimate. Analysis is still in progress; percentage and remaining count await the final total.",
              )
            : t(
                locale,
                "Gmail proporciona una estimación que puede cambiar. El total definitivo se confirma al terminar la lectura; el tiempo depende del volumen, los adjuntos y las esperas de Google.",
                "Gmail provides an estimate that can change. The final total is confirmed when scanning finishes; duration depends on volume, attachments and Google's waits.",
              )}
      </p>
    </>
  );
}
