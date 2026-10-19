"use client";
import { useEffect, useRef, useState } from "react";
import type { Locale, Opportunity, Workspace } from "@/lib/domain";
import { currency, dateLabel } from "@/lib/domain";
import type { UnderwritingRun, UnderwritingReport } from "@/lib/underwriting";
import { prepareUnderwritingDraft } from "@/lib/underwriting";
import { UnderwritingCompactReport } from "./underwriting-compact-report";
import { demoCompactUnderwriting } from "@/lib/underwriting-compact-demo";
import {
  UnderwritingObservations,
  UnderwritingOriginalOutput,
} from "./underwriting-observations";
import { Modal, t } from "./ui";
import { UnderwritingNotices } from "./underwriting-notices";
import { underwritingReadiness } from "@/lib/underwriting-status";
import {
  UnderwritingChecklist,
  UnderwritingProgressBar,
} from "./underwriting-readiness";
const labels: Record<UnderwritingRun["status"], [string, string]> = {
  queued: ["En cola", "Queued"],
  preparing: ["Preparando archivos", "Preparing files"],
  running: ["Analizando con IA", "Analyzing with AI"],
  draft: [
    "Informe disponible · Pendiente de revisión humana",
    "Report available · Awaiting human review",
  ],
  approved: ["Aprobado por el usuario", "Approved by user"],
  rejected: ["Descartado por el usuario", "Discarded by user"],
  failed: ["Requiere atención", "Needs attention"],
  uncertain: [
    "Resultado incierto: no se reintenta automáticamente",
    "Uncertain result: no automatic retry",
  ],
  outdated: ["Documentos modificados", "Documents changed"],
};
const factLabels: Record<string, [string, string]> = {
  confirmed: ["Confirmado", "Confirmed"],
  estimated: ["Estimado", "Estimated"],
  not_confirmed: ["Sin confirmar", "Not confirmed"],
  potential: ["Potencial por verificar", "Potential, verify"],
  criteria_not_met: [
    "No cumple los filtros internos",
    "Internal criteria not met",
  ],
  daily: ["Diario", "Daily"],
  weekly: ["Semanal", "Weekly"],
  biweekly: ["Quincenal", "Biweekly"],
  monthly: ["Mensual", "Monthly"],
  unknown: ["Desconocido", "Unknown"],
  current: ["Pagos vigentes", "Current payments"],
  possible_interruption: ["Posible interrupción", "Possible interruption"],
  confirmed_default: ["Default confirmado", "Confirmed default"],
  high: ["Alta", "High"],
  medium: ["Media", "Medium"],
  low: ["Baja", "Low"],
};
function factLabel(value: string, locale: Locale) {
  const label = factLabels[value];
  return label ? t(locale, ...label) : value;
}

export function UnderwritingWorkspace({
  data,
  opportunity: o,
  locale,
  editable,
  refresh,
  openDocuments,
}: {
  data: Workspace;
  opportunity: Opportunity;
  locale: Locale;
  editable: boolean;
  refresh: () => Promise<void>;
  openDocuments?: () => void;
}) {
  const [runs, setRuns] = useState<UnderwritingRun[]>([]),
    [configured, setConfigured] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [review, setReview] = useState<UnderwritingRun | null>(null),
    [copied, setCopied] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const requestedRun = useRef<string | null>(null);
  const [pdfLocale, setPdfLocale] = useState<Locale>(locale);
  useEffect(() => setPdfLocale(locale), [locale]);
  const [summary, setSummary] = useState(""),
    [conclusion, setConclusion] = useState(""),
    [observations, setObservations] = useState(""),
    [recommendations, setRecommendations] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const docs = data.documents.filter(
    (d) => d.opportunity_id === o.id && d.kind !== "analysis_report",
  );
  const ready = underwritingReadiness(docs, !!data.demo).ready;
  const active = runs.some((r) =>
    ["queued", "preparing", "running"].includes(r.status),
  );
  async function load(signal?: AbortSignal) {
    if (data.demo || data.crm_extensions_ready === false) return;
    const r = await fetch(
      `/api/underwriting?${new URLSearchParams({ opportunity: o.id })}`,
      { signal },
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.error);
    if (signal?.aborted) return;
    setRuns(value.runs);
    setConfigured(value.configured);
    const completed = value.runs.find(
      (run: UnderwritingRun) => run.id === requestedRun.current && run.report,
    );
    if (completed) {
      requestedRun.current = null;
      openReview(completed);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setRuns([]);
    requestedRun.current = null;
    setError("");
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [o.id, data.demo, data.crm_extensions_ready]);
  useEffect(() => {
    if (data.demo || data.crm_extensions_ready === false) return;
    const controller = new AbortController();
    const interval = setInterval(
      () => {
        if (document.hidden) return;
        void load(controller.signal).catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
      },
      active ? 2000 : 10000,
    );
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [o.id, data.demo, data.crm_extensions_ready, active]);
  function openReview(run: UnderwritingRun) {
    setReview(run);
    setPdfLocale(locale);
    setSummary(
      run.report?.compact_report?.conclusion[locale] ||
        run.report?.summary ||
        "",
    );
    setConclusion(
      run.report?.compact_report?.pitch[locale] || run.report?.strategy || "",
    );
    setObservations(
      [
        ...(run.report?.compact_report?.pending.map((item) => item[locale]) ||
          run.report?.missing_information ||
          []),
        t(
          locale,
          "Revisión judicial pendiente en NYSCEF.",
          "NYSCEF court review pending.",
        ),
      ].join("\n"),
    );
    setRecommendations(
      (run.report?.compact_report
        ? run.report.compact_report.lenders
            .filter((l) => l.fit !== "exclude")
            .map((l) => `${l.name}: ${l.reason[locale]}`)
            .join("\n")
        : run.report?.lender_matches
            .map((l) => `${l.name}: ${l.reason}`)
            .join("\n")) ||
        t(
          locale,
          "Completar guidelines y selección de lenders con el equipo.",
          "Review guidelines and lender selection with the team.",
        ),
    );
    setConfirmed(false);
    setRejectionNote("");
    setCopied(false);
  }
  function demoGenerate() {
    const report: UnderwritingReport = {
      merchant: {
        name: o.company,
        industry: o.industry,
        credit_score: null,
        years_in_business: null,
        profitable_on_taxes: null,
        positions_last_12_months: null,
        evidence: [],
      },
      monthly_financials: docs
        .filter((d) => d.kind === "bank_statement")
        .map((d, i) => ({
          document_id: d.id,
          period: d.period,
          deposits: [120000, 115000, 110000, 108000][i % 4],
          funding_deposits: i === 1 ? 20000 : 0,
          internal_transfers: 5000,
          other_non_operating_deposits: 0,
          operating_debits: 60000,
          debt_debits: 5000,
          ending_balance: 25000 - i * 1000,
          minimum_balance: 15000,
          average_balance: 30000,
          negative_balance_days: 0,
          net_debit_days: null,
          confidence: "estimated",
          evidence: [],
        })),
      positions: [],
      risks: [
        {
          severity: "medium",
          title: "Demostración sin lectura de archivos reales",
          details:
            "Este informe muestra el formato; no corresponde a underwriting real.",
          confidence: "not_confirmed",
          evidence: [],
        },
      ],
      sba: {
        status: "not_confirmed",
        reasons: [
          "No hay crédito ni declaraciones de impuestos en esta demostración.",
        ],
        missing_evidence: [
          "Crédito",
          "Antigüedad",
          "Declaraciones fiscales",
          "Historial de doce meses",
        ],
      },
      suggested_tier: "1",
      tier_reason:
        "Ejemplo ficticio de una sugerencia de tier 1 sin crédito confirmado, para mostrar la revisión humana.",
      lender_matches: [],
      reverse_consolidation: {
        consider: false,
        reason: "No se confirmaron posiciones MCA.",
      },
      summary: `Informe de demostración para ${o.company}.`,
      strategy: "Revisar la información antes de presentar el expediente.",
      client_pitch:
        "We will review your statements and confirm suitable financing options.",
      crm_notes:
        "DEMO: documentación disponible. Confirmar crédito, flujo y posiciones antes de presentar.",
      next_action: "Revisión del equipo",
      missing_information: ["Este ejemplo no realiza llamadas a OpenAI."],
    };
    report.compact_report = demoCompactUnderwriting(
      o.company,
      docs.map((d) => ({
        ...d,
        required: d.required !== false,
        storage_path: d.storage_path || "demo",
        content_hash: d.content_hash || "demo",
      })),
    );
    const generated: UnderwritingRun = {
      id: crypto.randomUUID(),
      opportunity_id: o.id,
      status: "draft",
      requested_by: data.profile.id,
      created_at: new Date().toISOString(),
      model: "demo",
      prompt_version: data.underwriting_settings?.version || 1,
      document_snapshot: docs.map((d) => ({
        ...d,
        content_hash: d.content_hash || "demo",
        storage_path: d.storage_path || "demo",
        required: d.required !== false,
      })),
      report: prepareUnderwritingDraft(
        report,
        docs.map((d) => ({
          ...d,
          content_hash: d.content_hash || "demo",
          storage_path: d.storage_path || "demo",
          required: d.required !== false,
        })),
        [],
      ),
      last_error: null,
      input_tokens: null,
      output_tokens: null,
      analysis_id: null,
    };
    setRuns([generated, ...runs]);
    openReview(generated);
  }
  async function generate() {
    setBusy(true);
    setError("");
    try {
      if (data.demo) {
        demoGenerate();
        return;
      }
      const r = await fetch("/api/underwriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          opportunity_id: o.id,
          request_key: requestKey,
        }),
      });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      requestedRun.current = value.id;
      setRequestKey(crypto.randomUUID());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!review) return;
    if (data.demo) {
      setRuns((previous) =>
        previous.map((run) =>
          run.id === review.id
            ? {
                ...run,
                status: "approved",
                reviewed_by: data.profile.id,
                reviewed_at: new Date().toISOString(),
              }
            : run,
        ),
      );
      setReview(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/underwriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          run_id: review.id,
          summary,
          conclusion,
          observations,
          recommendations,
        }),
      });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      await refresh();
      await load();
      setReview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    if (!review || !rejectionNote.trim() || !confirmed) return;
    if (data.demo) {
      setRuns((previous) =>
        previous.map((run) =>
          run.id === review.id
            ? {
                ...run,
                status: "rejected",
                review_notes: rejectionNote.trim(),
                reviewed_by: data.profile.id,
                reviewed_at: new Date().toISOString(),
              }
            : run,
        ),
      );
      setReview(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/underwriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          run_id: review.id,
          notes: rejectionNote,
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      await refresh();
      await load();
      setReview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function downloadDemo(run: UnderwritingRun) {
    setBusy(true);
    setError("");
    try {
      const { underwritingPdf } = await import("@/lib/underwriting-pdf");
      const bytes = await underwritingPdf(run, o.company, pdfLocale);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `analisis-demo-${pdfLocale}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError(
        t(
          locale,
          "No se pudo generar el PDF.",
          "The PDF could not be generated.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (data.crm_extensions_ready === false)
    return (
      <p className="muted">
        {t(
          locale,
          "Análisis con IA pendiente de activación por el administrador. Puedes continuar registrando el análisis manual.",
          "AI analysis awaits administrator activation. Manual analysis remains available.",
        )}
      </p>
    );
  const report = review?.report;
  const amount = (value: number | null | undefined) =>
    value == null
      ? t(locale, "No confirmado", "Not confirmed")
      : currency(value, locale);
  return (
    <section className="analysis-card">
      <div className="activity-toolbar">
        <h2>
          {t(locale, "Análisis de documentos con IA", "AI document analysis")}
        </h2>
        {editable && (
          <button
            className="button primary"
            disabled={busy || active || !ready || (!data.demo && !configured)}
            onClick={() => void generate()}
          >
            {t(
              locale,
              "Analizar documentos aprobados",
              "Analyze approved documents",
            )}
          </button>
        )}
      </div>
      {runs[0] && <UnderwritingProgressBar run={runs[0]} locale={locale} />}
      <UnderwritingChecklist
        documents={docs}
        locale={locale}
        demo={data.demo}
        openDocuments={openDocuments}
      />
      <p>
        {t(
          locale,
          "El resultado es un borrador. Conserva las versiones de los archivos y del prompt utilizados y necesita revisión del equipo.",
          "Results are drafts. File and prompt versions are preserved and team review is required.",
        )}
      </p>
      {data.demo && (
        <p className="muted">
          {t(
            locale,
            "Demostración: informe ficticio sin llamadas a la API.",
            "Demo: fictional report without API calls.",
          )}
        </p>
      )}
      <UnderwritingNotices
        locale={locale}
        error={error}
        runs={runs}
        messages={[
          ...(!ready
            ? [
                t(
                  locale,
                  "Aprueba la aplicación y al menos cuatro extractos en total, además de los requisitos obligatorios. Se analizarán todos los extractos aprobados de cada banco.",
                  "Approve the application, at least four statements in total and all required documents. All approved statements from every bank will be analyzed.",
                ),
              ]
            : []),
          ...(!data.demo && !configured
            ? [
                t(
                  locale,
                  "Conexión de OpenAI pendiente de configuración.",
                  "OpenAI configuration pending.",
                ),
              ]
            : []),
        ]}
      />
      {runs.map((run) => (
        <div className="document-row" key={run.id}>
          <div>
            <strong>{t(locale, ...labels[run.status])}</strong>
            <small>
              {dateLabel(run.created_at, locale, true)} · {run.model} · Prompt v
              {run.prompt_version}
            </small>
          </div>
          {run.report && (
            <button className="button" onClick={() => openReview(run)}>
              {t(locale, "Ver análisis", "View analysis")}
            </button>
          )}
        </div>
      ))}
      {review && report && (
        <Modal
          wide
          title={t(locale, "Revisión del análisis", "Analysis review")}
          close={() => {
            if (!busy) setReview(null);
          }}
        >
          <UnderwritingNotices locale={locale} error={error} />
          <p>
            <strong>{o.company}</strong> · {t(locale, ...labels[review.status])}{" "}
            · {review.model} · Prompt v{review.prompt_version}
          </p>
          <label className="field underwriting-pdf-language">
            {t(locale, "Idioma del PDF", "PDF language")}
            <select
              value={pdfLocale}
              onChange={(e) => setPdfLocale(e.target.value as Locale)}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          {data.demo ? (
            <button
              className="button"
              disabled={busy}
              onClick={() => void downloadDemo(review)}
            >
              {t(locale, "Descargar informe PDF", "Download PDF report")}
            </button>
          ) : (
            <a
              className="button"
              href={`/api/underwriting/report?${new URLSearchParams({ run: review.id, locale: pdfLocale })}`}
              target="_blank"
              rel="noreferrer"
            >
              {t(locale, "Descargar informe PDF", "Download PDF report")}
            </a>
          )}
          {report.compact_report ? (
            <>
              <UnderwritingCompactReport
                report={report}
                locale={locale}
                documents={review.document_snapshot}
              />
              <button
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      report.compact_report!.crm_notes[locale],
                    );
                    setCopied(true);
                  } catch {
                    setError(
                      t(
                        locale,
                        "Selecciona y copia el texto de las notas.",
                        "Select and copy the notes text.",
                      ),
                    );
                  }
                }}
              >
                {copied
                  ? t(locale, "Copiado", "Copied")
                  : t(locale, "Copiar notas para CRM", "Copy CRM notes")}
              </button>
              <UnderwritingObservations report={report} locale={locale} />
            </>
          ) : (
            <>
              <p className="muted">
                {t(
                  locale,
                  "Informe anterior al formato bilingüe: su texto conserva el idioma original. Los nuevos análisis incluyen ambas versiones.",
                  "This report predates the bilingual format: its text retains the original language. New analyses include both versions.",
                )}
              </p>
              <UnderwritingObservations report={report} locale={locale} />
            </>
          )}
          {review.review_notes && (
            <p>
              <strong>
                {t(locale, "Observación del usuario", "User review note")}:
              </strong>{" "}
              {review.review_notes}
            </p>
          )}
          <details
            className="underwriting-technical-details"
            open={report.compact_report ? undefined : true}
          >
            <summary>
              {t(
                locale,
                "Ver detalle técnico, fuentes y respuesta original",
                "View technical details, sources and original response",
              )}
            </summary>
            {report.unstructured ? (
              <>
                <h3>
                  {t(
                    locale,
                    "Contenido original de la IA",
                    "Original AI content",
                  )}
                </h3>
                <UnderwritingOriginalOutput
                  output={report.original_output}
                  locale={locale}
                />
              </>
            ) : (
              <>
                <h3>{t(locale, "Resumen", "Summary")}</h3>
                <p>{report.summary}</p>
                <h3>{t(locale, "Posiciones MCA", "MCA positions")}</h3>
                {!report.positions.length && (
                  <p>
                    {t(
                      locale,
                      "No se identificaron posiciones confirmadas; revisa los archivos y los datos faltantes.",
                      "No confirmed positions identified; review files and missing information.",
                    )}
                  </p>
                )}
                {report.positions.map((p, i) => (
                  <div className="analysis-card" key={i}>
                    <strong>{p.name}</strong>
                    <p>
                      {amount(p.funded_amount)} ·{" "}
                      {p.funding_date ||
                        t(
                          locale,
                          "Fecha no confirmada",
                          "Date unconfirmed",
                        )}{" "}
                      · {factLabel(p.payment_frequency, locale)} ·{" "}
                      {amount(p.payment_amount)} ·{" "}
                      {factLabel(p.payment_status, locale)} ·{" "}
                      {factLabel(p.confidence, locale)}
                    </p>
                    <p>{p.notes}</p>
                    <Evidence refs={p.evidence} run={review} locale={locale} />
                  </div>
                ))}
                <h3>
                  {t(locale, "Flujo de caja mensual", "Monthly cash flow")}
                </h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Período",
                          "Depósitos",
                          "Fondeos excluidos",
                          "Ingresos reales",
                          "Deuda",
                          "Flujo disponible",
                          "Deuda / ingresos",
                          "Ingresos / deuda",
                          "Saldo diario mínimo / promedio",
                          "Días de saldo negativo",
                          "Días con débitos > depósitos",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.monthly_financials.map((m) => {
                        const calculated =
                          report.calculated_metrics?.find(
                            (c) => c.document_id === m.document_id,
                          ) ||
                          report.calculated_metrics?.find(
                            (c) => !c.document_id && c.period === m.period,
                          );
                        return (
                          <tr key={m.document_id}>
                            <td>
                              {
                                review.document_snapshot.find(
                                  (d) => d.id === m.document_id,
                                )?.bank_name
                              }{" "}
                              ·{" "}
                              {m.period ||
                                t(
                                  locale,
                                  "Período sin confirmar",
                                  "Period unconfirmed",
                                )}{" "}
                              · {factLabel(m.confidence, locale)}
                            </td>
                            <td>{amount(m.deposits)}</td>
                            <td>{amount(m.funding_deposits)}</td>
                            <td>{amount(calculated?.true_revenue)}</td>
                            <td>{amount(m.debt_debits)}</td>
                            <td>{amount(calculated?.available_cash_flow)}</td>
                            <td>
                              {calculated?.debt_to_revenue == null
                                ? "—"
                                : `${(calculated.debt_to_revenue * 100).toFixed(1)}%`}
                            </td>
                            <td>
                              {calculated?.revenue_to_debt == null
                                ? "—"
                                : `${calculated.revenue_to_debt.toFixed(2)}×`}
                            </td>
                            <td>
                              {amount(m.minimum_balance)} /{" "}
                              {amount(m.average_balance)}
                            </td>
                            <td>{m.negative_balance_days ?? "—"}</td>
                            <td>{m.net_debit_days ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="muted">
                  {t(
                    locale,
                    "Ingresos reales = depósitos − fondeos − transferencias internas − otros ingresos no operativos. Flujo disponible = ingresos reales − débitos operativos − deuda. Las estimaciones y datos incompletos permanecen identificados.",
                    "True revenue excludes funding, internal transfers and non-operating deposits. Available cash flow subtracts operating debits and debt. Estimates and missing data remain identified.",
                  )}
                </p>
                {report.monthly_financials.map((m) => (
                  <details key={m.document_id}>
                    <summary>
                      {
                        review.document_snapshot.find(
                          (d) => d.id === m.document_id,
                        )?.bank_name
                      }{" "}
                      ·{" "}
                      {m.period ||
                        t(
                          locale,
                          "Período sin confirmar",
                          "Period unconfirmed",
                        )}{" "}
                      · {t(locale, "Ver evidencia", "View evidence")}
                    </summary>
                    <Evidence refs={m.evidence} run={review} locale={locale} />
                    <p>
                      {t(
                        locale,
                        "Saldo final / mínimo / promedio",
                        "Ending / minimum / average balance",
                      )}
                      : {amount(m.ending_balance)} / {amount(m.minimum_balance)}{" "}
                      / {amount(m.average_balance)}
                    </p>
                  </details>
                ))}
                <h3>{t(locale, "Riesgos", "Risks")}</h3>
                {report.risks.map((r, i) => (
                  <div key={i}>
                    <strong>
                      {r.title} · {factLabel(r.severity, locale)} ·{" "}
                      {factLabel(r.confidence, locale)}
                    </strong>
                    <p>{r.details}</p>
                    <Evidence refs={r.evidence} run={review} locale={locale} />
                  </div>
                ))}
                <h3>
                  {t(
                    locale,
                    "Potencial SBA y datos del cliente",
                    "SBA screening and client data",
                  )}
                </h3>
                <p>
                  {t(
                    locale,
                    "Nombre identificado por la IA",
                    "AI-identified name",
                  )}
                  : {report.merchant.name} ·{" "}
                  {t(locale, "Industria", "Industry")}:{" "}
                  {report.merchant.industry ||
                    t(locale, "Sin confirmar", "Not confirmed")}
                </p>
                <p>
                  {factLabel(report.sba.status, locale)} ·{" "}
                  {t(locale, "Crédito", "Credit")}:{" "}
                  {report.merchant.credit_score ?? "—"} ·{" "}
                  {t(locale, "Años en operación", "Years in business")}:{" "}
                  {report.merchant.years_in_business ?? "—"}
                </p>
                <p>
                  {t(locale, "Rentabilidad fiscal", "Tax profitability")}:{" "}
                  {report.merchant.profitable_on_taxes === null
                    ? t(locale, "Sin confirmar", "Not confirmed")
                    : report.merchant.profitable_on_taxes
                      ? t(locale, "Sí", "Yes")
                      : "No"}{" "}
                  ·{" "}
                  {t(
                    locale,
                    "Posiciones en los últimos 12 meses",
                    "Positions in last 12 months",
                  )}
                  :{" "}
                  {report.merchant.positions_last_12_months ??
                    t(locale, "Sin confirmar", "Not confirmed")}
                </p>
                <p>
                  {[...report.sba.reasons, ...report.sba.missing_evidence].join(
                    " · ",
                  )}
                </p>
                <Evidence
                  refs={report.merchant.evidence}
                  run={review}
                  locale={locale}
                />
                <h3>{t(locale, "Revisión judicial", "Court review")}</h3>
                <p>
                  {t(
                    locale,
                    "Pendiente de comprobación manual. Este análisis no afirma haber consultado NYSCEF.",
                    "Pending manual verification. This analysis does not claim a NYSCEF search.",
                  )}
                </p>
                <a
                  href="https://iapps.courts.state.ny.us/nyscef/CaseSearch?TAB=name"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t(
                    locale,
                    "Abrir búsqueda oficial NYSCEF",
                    "Open official NYSCEF search",
                  )}
                </a>
                <h3>
                  {t(locale, "Tier sugerido por la IA", "AI-suggested tier")}:{" "}
                  {factLabel(report.suggested_tier, locale)}
                </h3>
                <p>{report.tier_reason}</p>
                {report.lender_matches.map((l) => (
                  <p key={l.lender_id}>
                    <strong>{l.name}</strong>: {l.reason}
                    <br />
                    {l.missing_requirements.join(" · ")}
                  </p>
                ))}
                <h3>
                  {t(locale, "Reverse consolidation", "Reverse consolidation")}
                </h3>
                <p>{report.reverse_consolidation.reason}</p>
                <h3>{t(locale, "Estrategia y pitch", "Strategy and pitch")}</h3>
                <p>{report.strategy}</p>
                <p>{report.client_pitch}</p>
                <h3>{t(locale, "Notas para CRM", "CRM notes")}</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{report.crm_notes}</p>
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(report.crm_notes);
                      setCopied(true);
                    } catch {
                      setError(
                        t(
                          locale,
                          "Selecciona y copia el texto de las notas.",
                          "Select and copy the notes text.",
                        ),
                      );
                    }
                  }}
                >
                  {copied
                    ? t(locale, "Copiado", "Copied")
                    : t(locale, "Copiar notas", "Copy notes")}
                </button>
                <h3>
                  {t(
                    locale,
                    "Información pendiente y siguiente acción",
                    "Missing information and next action",
                  )}
                </h3>
                <p>{report.missing_information.join(" · ")}</p>
                <p>{report.next_action}</p>
              </>
            )}
            {!report.unstructured && report.original_output !== undefined && (
              <details>
                <summary>
                  {t(
                    locale,
                    "Ver contenido original completo de la IA",
                    "View complete original AI content",
                  )}
                </summary>
                <UnderwritingOriginalOutput
                  output={report.original_output}
                  locale={locale}
                />
              </details>
            )}
            <details>
              <summary>
                {t(locale, "Archivos utilizados", "Source files")}
              </summary>
              {review.document_snapshot.map((d) => (
                <p key={d.id}>
                  {d.name} · {d.period} · {d.content_hash.slice(0, 12)}
                </p>
              ))}
            </details>
          </details>
          {review.status === "draft" && editable && (
            <>
              <h3>
                {t(locale, "Revisión final del equipo", "Final team review")}
              </h3>
              {[
                [t(locale, "Resumen", "Summary"), summary, setSummary],
                [
                  t(locale, "Conclusión", "Conclusion"),
                  conclusion,
                  setConclusion,
                ],
                [
                  t(locale, "Observaciones", "Observations"),
                  observations,
                  setObservations,
                ],
                [
                  t(locale, "Lenders y motivos", "Lenders and reasons"),
                  recommendations,
                  setRecommendations,
                ],
              ].map(([label, value, setter]) => (
                <label className="field" key={label as string}>
                  {label as string}
                  <textarea
                    value={value as string}
                    maxLength={20000}
                    onChange={(e) =>
                      (setter as (v: string) => void)(e.target.value)
                    }
                  />
                </label>
              ))}
              <label className="document-review-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t(
                  locale,
                  "Revisé los cálculos, las evidencias y las limitaciones del borrador.",
                  "I reviewed calculations, evidence and draft limitations.",
                )}
              </label>
              <div className="modal-footer">
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !confirmed ||
                    !summary.trim() ||
                    !conclusion.trim() ||
                    !recommendations.trim()
                  }
                  onClick={() => void approve()}
                >
                  {t(
                    locale,
                    "Aprobar informe y guardar revisión",
                    "Approve report and save review",
                  )}
                </button>
              </div>
              <label className="field">
                {t(
                  locale,
                  "Motivo para descartar el informe",
                  "Reason for discarding the report",
                )}
                <textarea
                  value={rejectionNote}
                  maxLength={20000}
                  onChange={(e) => setRejectionNote(e.target.value)}
                />
              </label>
              <button
                className="button"
                disabled={busy || !confirmed || !rejectionNote.trim()}
                onClick={() => void reject()}
              >
                {t(
                  locale,
                  "Descartar informe y guardar observación",
                  "Discard report and save note",
                )}
              </button>
              <p className="muted">
                {t(
                  locale,
                  "Descartar conserva el informe para consulta. Puedes cerrar esta ventana y dejar la revisión pendiente.",
                  "Discarding keeps the report available. You can close this window and leave the review pending.",
                )}
              </p>
              {data.demo && (
                <p className="muted">
                  {t(
                    locale,
                    "Las decisiones de esta demostración se reinician al recargar.",
                    "Decisions in this demo reset on reload.",
                  )}
                </p>
              )}
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
function Evidence({
  refs,
  run,
  locale,
}: {
  refs: UnderwritingReport["merchant"]["evidence"];
  run: UnderwritingRun;
  locale: Locale;
}) {
  return (
    <>
      {refs.map((e, i) => (
        <p className="muted" key={i}>
          {run.document_snapshot.some((d) => d.id === e.document_id) ? (
            <a
              href={`/api/underwriting/files?${new URLSearchParams({ run: run.id, document: e.document_id })}`}
              target="_blank"
              rel="noreferrer"
            >
              {run.document_snapshot.find((d) => d.id === e.document_id)?.name}
            </a>
          ) : (
            <span>
              {t(
                locale,
                "Referencia sin archivo coincidente",
                "Reference without a matching file",
              )}
              : {e.document_id}
            </span>
          )}{" "}
          · {t(locale, "Página", "Page")} {e.page}: “{e.excerpt}”
        </p>
      ))}
    </>
  );
}
