"use client";
import { useEffect, useState } from "react";
import type { Locale, Workspace } from "@/lib/domain";
import { dateLabel, stageLabels } from "@/lib/domain";
import type { OperationalData } from "@/lib/operations";
import { defaultOperationalSettings } from "@/lib/operations";
import type { Action } from "./crm";
import { t } from "./ui";
export const operationalLabels: Record<string, [string, string]> = {
  all: ["Todas las activas", "All active"],
  attention: ["Necesitan atención", "Need attention"],
  reply: ["Por responder", "Awaiting reply"],
  overdue: ["Vencidas", "Overdue"],
  documents: ["Documentos", "Documents"],
  analysis: ["Análisis", "Analysis"],
  lender: ["Con lender", "With lender"],
  negotiation: ["En negociación", "In negotiation"],
  offers: ["Ofertas por vencer", "Expiring offers"],
  unassigned: ["Sin responsable", "Unassigned"],
  scheduled: ["Seguimiento programado", "Scheduled follow-up"],
};
export function OperationalDashboard({
  data,
  locale,
  filter,
  setFilter,
  page,
  setPage,
  open,
}: {
  data: OperationalData;
  locale: Locale;
  filter: string;
  setFilter: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  open: (id: string) => void;
}) {
  return (
    <section className="panel operational-panel">
      <div className="section-heading">
        <h2>{t(locale, "Seguimiento de clientes", "Client follow-up")}</h2>
        <span>
          {data.counts.active}{" "}
          {t(locale, "oportunidades activas", "active opportunities")}
        </span>
      </div>
      <p className="muted">
        {t(
          locale,
          `Respuesta del equipo: ${data.settings.reply_hours} horas. Seguimiento al cliente o lender: ${data.settings.followup_hours} horas. Plazos en horas calendario.`,
          `Team response: ${data.settings.reply_hours} hours. Client or lender follow-up: ${data.settings.followup_hours} hours. Calendar hours.`,
        )}
      </p>
      <div className="operational-filters">
        {Object.entries(operationalLabels)
          .filter(([key]) => !["unassigned", "scheduled"].includes(key))
          .map(([key, [es, en]]) => (
            <button
              className={`button ${filter === key ? "primary" : ""}`}
              key={key}
              onClick={() => {
                setFilter(key);
                setPage(0);
              }}
            >
              {t(locale, es, en)}{" "}
              <strong>
                {key === "all" ? data.counts.active : data.counts[key] || 0}
              </strong>
            </button>
          ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                t(locale, "Cliente / etapa", "Client / stage"),
                t(locale, "Atención y plazo", "Attention and deadline"),
                t(locale, "Esperando a / lender", "Waiting for / lender"),
                t(locale, "Responsable", "Owner"),
                t(locale, "Próxima acción", "Next action"),
              ].map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const priority =
                operationalLabels[row.priority] || operationalLabels.scheduled;
              const actions = [
                { label: row.next_task, date: row.next_task_at },
                {
                  label: row.handed_off_at ? null : row.next_action,
                  date: row.handed_off_at ? null : row.next_action_at,
                },
                {
                  label: row.next_lender_action,
                  date: row.next_lender_action_at,
                },
              ]
                .filter((a) => a.label && a.date)
                .sort((a, b) => a.date!.localeCompare(b.date!));
              return (
                <tr key={row.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => open(row.id)}
                    >
                      <strong>{row.company}</strong>
                    </button>
                    <small>{row.contact}</small>
                    <span className="badge">
                      {stageLabels[locale][row.stage]}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${row.overdue ? "stage-lost" : ""}`}
                    >
                      {t(locale, ...priority)}
                    </span>
                    {row.reply_due_at && (
                      <small>
                        {t(locale, "Responder antes de", "Reply by")}{" "}
                        {dateLabel(row.reply_due_at, locale, true)}
                      </small>
                    )}
                    {row.due_at && !row.reply_due_at && (
                      <small>{dateLabel(row.due_at, locale, true)}</small>
                    )}
                    {row.overdue_tasks > 0 && (
                      <small>
                        {row.overdue_tasks}{" "}
                        {t(locale, "tareas vencidas", "overdue tasks")}
                      </small>
                    )}
                    {row.document_review_count > 0 && (
                      <small>
                        {row.document_review_count}{" "}
                        {t(
                          locale,
                          "documentos por revisar",
                          "documents to review",
                        )}
                      </small>
                    )}
                    {row.missing_document_count > 0 && (
                      <small>
                        {row.missing_document_count}{" "}
                        {t(locale, "documentos faltantes", "missing documents")}
                      </small>
                    )}
                    {row.analysis_status && (
                      <small>IA: {row.analysis_status}</small>
                    )}
                    {row.expiring_offer_count > 0 && (
                      <small>
                        {row.expiring_offer_count}{" "}
                        {t(
                          locale,
                          "ofertas por vencer / vencidas",
                          "expiring / expired offers",
                        )}
                      </small>
                    )}
                  </td>
                  <td>
                    {row.waiting_for
                      ? t(
                          locale,
                          {
                            team: "Equipo",
                            client: "Cliente",
                            lender: "Lender",
                          }[row.waiting_for],
                          { team: "Team", client: "Client", lender: "Lender" }[
                            row.waiting_for
                          ],
                        )
                      : "—"}
                    {row.lenders.map((l, i) => (
                      <small key={`${l.id}-${i}`}>
                        {l.name} · {l.status}
                      </small>
                    ))}
                    {row.followup_due_at && (
                      <small>
                        {t(locale, "Seguimiento", "Follow-up")}:{" "}
                        {dateLabel(row.followup_due_at, locale, true)}
                      </small>
                    )}
                  </td>
                  <td>
                    {row.owner_name || t(locale, "Sin asignar", "Unassigned")}
                  </td>
                  <td>
                    {row.reply_count > 0
                      ? t(
                          locale,
                          "Responder la conversación pendiente",
                          "Reply to pending conversation",
                        )
                      : row.document_review_count > 0
                        ? t(
                            locale,
                            "Revisar documentos recibidos",
                            "Review received documents",
                          )
                        : row.analysis_status === "draft"
                          ? t(
                              locale,
                              "Revisar borrador del análisis",
                              "Review analysis draft",
                            )
                          : actions[0]?.label ||
                            t(
                              locale,
                              "Definir siguiente paso",
                              "Set next action",
                            )}
                    <button
                      className="text-button"
                      onClick={() => open(row.id)}
                    >
                      {t(locale, "Abrir ficha", "Open case")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!data.rows.length && (
        <p>
          {t(
            locale,
            "No hay clientes con este filtro.",
            "No clients match this filter.",
          )}
        </p>
      )}
      <div className="card-actions">
        <span>
          {page * 50 + Math.min(1, data.total)}–
          {Math.min(page * 50 + data.rows.length, data.total)} / {data.total}
        </span>
        <button
          className="button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          {t(locale, "Anterior", "Previous")}
        </button>
        <button
          className="button"
          disabled={(page + 1) * 50 >= data.total}
          onClick={() => setPage(page + 1)}
        >
          {t(locale, "Siguiente", "Next")}
        </button>
      </div>
    </section>
  );
}
export function OperationalSettingsPanel({
  data,
  locale,
  act,
  refresh,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  refresh: () => Promise<void>;
}) {
  const [settings, setSettings] = useState(
      data.operational?.settings || defaultOperationalSettings,
    ),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (data.demo) return;
    const controller = new AbortController();
    void fetch("/api/operations/settings", { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setSettings(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [data.demo]);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      if (data.demo) await act("operational_settings", settings);
      else {
        const r = await fetch("/api/operations/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...settings,
            expected_version: settings.version,
            request_key: requestKey,
          }),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        await refresh();
      }
      setSettings((s) => ({ ...s, version: s.version + 1 }));
      setSaved(true);
      setRequestKey(crypto.randomUUID());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>
        {t(locale, "Plazos de seguimiento", "Follow-up deadlines")} · v
        {settings.version}
      </h2>
      <p>
        {t(
          locale,
          "Horas calendario desde el último mensaje; la alerta no envía correos automáticamente.",
          "Calendar hours since the last message; alerts do not automatically send email.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset
        disabled={busy || data.profile.role !== "superadmin"}
        style={{ border: 0, padding: 0 }}
      >
        {(
          [
            ["reply_hours", "Responder al cliente o lender / Reply", 720],
            ["followup_hours", "Seguimiento sin respuesta / Follow-up", 2160],
            [
              "offer_warning_hours",
              "Avisar antes de vencer una oferta / Offer warning",
              720,
            ],
          ] as const
        ).map(([key, label, max]) => (
          <label className="field" key={key}>
            {label}
            <input
              type="number"
              min={1}
              max={max}
              value={settings[key]}
              onChange={(e) => {
                setSettings((s) => ({ ...s, [key]: Number(e.target.value) }));
                setRequestKey(crypto.randomUUID());
                setSaved(false);
              }}
            />
          </label>
        ))}
        {data.profile.role === "superadmin" && (
          <button className="button primary" onClick={() => void save()}>
            {t(locale, "Guardar plazos", "Save deadlines")}
          </button>
        )}
      </fieldset>
      {saved && (
        <p role="status">
          {t(locale, "Plazos guardados.", "Deadlines saved.")}
        </p>
      )}
    </section>
  );
}
