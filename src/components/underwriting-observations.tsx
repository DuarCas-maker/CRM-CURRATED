import type { Locale } from "@/lib/domain";
import type { UnderwritingDraft } from "@/lib/underwriting";
import {
  underwritingOutputLines,
  underwritingWarning,
} from "@/lib/underwriting-document";
import { t } from "./ui";
export function UnderwritingObservations({
  report,
  locale,
}: {
  report: UnderwritingDraft;
  locale: Locale;
}) {
  const warnings = report.validation_warnings || [];
  return (
    <section
      className="underwriting-observations"
      aria-label={t(
        locale,
        "Observaciones para revisión humana",
        "Observations for human review",
      )}
    >
      <h3>
        {t(
          locale,
          "Observaciones para revisión humana",
          "Observations for human review",
        )}
      </h3>
      <p>
        {t(
          locale,
          "El informe está disponible. Estas observaciones no lo aprueban ni lo rechazan: tú decides después de revisar el contenido y sus fuentes.",
          "The report is available. These observations do not approve or reject it: you decide after reviewing the content and its sources.",
        )}
      </p>
      {warnings.length ? (
        <ul>
          {warnings.map((code) => (
            <li key={code}>
              {underwritingWarning(code, locale)} <small>({code})</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {t(
            locale,
            "Sin observaciones automáticas registradas. Pendiente de revisión del usuario.",
            "No automatic observations recorded. Awaiting user review.",
          )}
        </p>
      )}
    </section>
  );
}
export function UnderwritingOriginalOutput({
  output,
  locale,
}: {
  output: unknown;
  locale: Locale;
}) {
  return (
    <div className="underwriting-original-output">
      {underwritingOutputLines(output, locale).map((line, i) =>
        line.heading ? (
          <h4 key={i}>{line.text}</h4>
        ) : (
          <p key={i}>{line.text}</p>
        ),
      )}
    </div>
  );
}
