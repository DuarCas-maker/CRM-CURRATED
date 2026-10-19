import type { Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import type { UnderwritingRun } from "@/lib/underwriting";
import { underwritingWarning } from "@/lib/underwriting-document";
import { UnderwritingFailure } from "./underwriting-readiness";
import { t } from "./ui";

export function UnderwritingNotices({
  locale,
  error = "",
  messages = [],
  runs = [],
}: {
  locale: Locale;
  error?: string;
  messages?: string[];
  runs?: UnderwritingRun[];
}) {
  const notices = runs.filter(
    (run) => run.last_error || run.report?.validation_warnings?.length,
  );
  const count =
    Number(!!error) +
    messages.length +
    notices.reduce(
      (total, run) =>
        total +
        Number(!!run.last_error) +
        (run.report?.validation_warnings?.length || 0),
      0,
    );
  if (!count) return null;
  return (
    <details className="underwriting-notices">
      <summary>
        {t(
          locale,
          "Errores, advertencias y observaciones",
          "Errors, warnings and observations",
        )}{" "}
        ({count})
      </summary>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
      {notices.map((run) => (
        <section key={run.id}>
          <h3>
            {dateLabel(run.created_at, locale, true)} · {run.model} · Prompt v
            {run.prompt_version}
          </h3>
          <UnderwritingFailure run={run} locale={locale} />
          {!!run.report?.validation_warnings?.length && (
            <ul>
              {run.report.validation_warnings.map((code) => (
                <li key={code}>
                  {underwritingWarning(code, locale)} <small>({code})</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </details>
  );
}
