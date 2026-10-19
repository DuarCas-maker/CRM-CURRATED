"use client";
import "./ai-usage-panel.css";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/domain";
import { dateLabel } from "@/lib/domain";
import {
  AI_SERVICE_KEYS,
  AI_SERVICE_LABELS,
  type AiService,
  type AiUsageSummary,
  type AiUsageEvent,
} from "@/lib/ai-usage";
import { t } from "./ui";

export function AiUsagePanel({
  locale,
  demo,
}: {
  locale: Locale;
  demo: boolean;
}) {
  const [days, setDays] = useState(30),
    [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<AiUsageSummary[]>([]),
    [events, setEvents] = useState<AiUsageEvent[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (demo) {
      setRows(
        (Object.keys(AI_SERVICE_KEYS) as AiService[]).map((service, i) => ({
          service,
          model: "demo",
          calls: [3, 5, 8][i],
          completed: [3, 4, 8][i],
          failed: i === 1 ? 1 : 0,
          uncertain: 0,
          started: 0,
          unknown_usage: 0,
          input_tokens: [24000, 16000, 9000][i],
          output_tokens: [6000, 4000, 800][i],
          cached_input_tokens: 0,
          reasoning_tokens: 0,
        })),
      );
      setEvents([]);
      return () => controller.abort();
    }
    setBusy(true);
    void fetch(`/api/ai/usage?days=${days}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Usage unavailable");
        if (!controller.signal.aborted) {
          setRows(body.summary);
          setEvents(body.events);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [days, revision, demo]);
  const n = (value: number | null) =>
    value === null
      ? "—"
      : value.toLocaleString(locale === "es" ? "es-CO" : "en-US");
  const serviceName = (service: AiService) =>
    AI_SERVICE_LABELS[service][locale === "es" ? 0 : 1];
  const status = {
    started: ["Sin cierre confirmado", "Finalization pending"],
    completed: ["Respuesta recibida", "Response received"],
    failed: ["Falló", "Failed"],
    uncertain: ["Resultado incierto", "Uncertain result"],
  };
  return (
    <div className="settings-panel ai-usage-panel" aria-busy={busy}>
      <h3>{t(locale, "Consumo de IA por servicio", "AI usage by service")}</h3>
      <p>
        {demo
          ? t(
              locale,
              "DEMO: cifras ficticias, sin llamadas a OpenAI.",
              "DEMO: fictional figures, no OpenAI calls.",
            )
          : t(
              locale,
              "Registro desde la activación de esta versión. Solo visible para el superadmin.",
              "Recorded since this version was activated. Superadmin only.",
            )}
      </p>
      <label className="field">
        {t(locale, "Período", "Period")}
        <select
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        >
          {[7, 30, 90].map((value) => (
            <option key={value} value={value}>
              {t(locale, `Últimos ${value} días`, `Last ${value} days`)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => setRevision((value) => value + 1)}
      >
        {t(locale, "Actualizar consumo", "Refresh usage")}
      </button>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    t(locale, "Servicio / modelo", "Service / model"),
                    t(locale, "Llamadas", "Calls"),
                    t(locale, "Entrada", "Input"),
                    t(locale, "Caché", "Cached"),
                    t(locale, "Salida", "Output"),
                    t(locale, "Razonamiento", "Reasoning"),
                    t(locale, "Consumo sin confirmar", "Unknown usage"),
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.service}-${row.model}`}>
                    <td>
                      {serviceName(row.service)}
                      <br />
                      <small>
                        {AI_SERVICE_KEYS[row.service]} · {row.model}
                      </small>
                    </td>
                    <td>
                      {n(row.calls)}
                      <br />
                      <small>
                        {t(
                          locale,
                          "Fallos / inciertas / sin cierre",
                          "Failed / uncertain / pending",
                        )}
                        : {row.failed} / {row.uncertain} / {row.started}
                      </small>
                    </td>
                    <td>{n(row.input_tokens)}</td>
                    <td>{n(row.cached_input_tokens)}</td>
                    <td>{n(row.output_tokens)}</td>
                    <td>{n(row.reasoning_tokens)}</td>
                    <td>{n(row.unknown_usage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <p>
              {t(
                locale,
                "Todavía no hay llamadas registradas en este período.",
                "No calls recorded for this period yet.",
              )}
            </p>
          )}
          <p className="muted">
            {t(
              locale,
              "Totales de tokens conocidos. Caché ya está incluida en entrada y razonamiento en salida: no se suman de nuevo. Un consumo sin confirmar no significa costo cero. Los importes facturados se consultan en OpenAI por clave o proyecto.",
              "Known token totals. Cached tokens are included in input and reasoning in output: do not add them again. Unknown usage does not mean zero cost. Check billed amounts in OpenAI by key or project.",
            )}
          </p>
          {!!events.length && (
            <details>
              <summary>
                {t(
                  locale,
                  "Últimas 50 llamadas del período",
                  "Latest 50 calls in period",
                )}
              </summary>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        t(locale, "Fecha / servicio", "Date / service"),
                        t(locale, "Estado", "Status"),
                        t(locale, "Entrada / salida", "Input / output"),
                        t(locale, "Referencia", "Reference"),
                      ].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td>
                          {dateLabel(event.started_at, locale, true)}
                          <br />
                          {serviceName(event.service)} · {event.model}
                        </td>
                        <td>
                          {status[event.status][locale === "es" ? 0 : 1]}
                          <br />
                          {event.error_code}
                        </td>
                        <td>
                          {n(event.input_tokens)} / {n(event.output_tokens)}
                        </td>
                        <td>{event.provider_response_id || event.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
