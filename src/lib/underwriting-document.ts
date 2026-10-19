import type { Locale } from "./domain";
import type { UnderwritingRun } from "./underwriting";

const warnings: Record<string, [string, string]> = {
  UNKNOWN_EVIDENCE: [
    "Hay referencias que no coinciden con los archivos de este análisis.",
    "Some references do not match this analysis's source files.",
  ],
  INVALID_STATEMENT_PERIOD: [
    "Revisar el período, la identificación o la repetición de un extracto.",
    "Review a statement's period, identifier or duplicate entry.",
  ],
  MISSING_EVIDENCE: [
    "Hay cifras, posiciones o riesgos sin una cita documental suficiente.",
    "Some figures, positions or risks lack sufficient source evidence.",
  ],
  INVALID_DAY_COUNT: [
    "La cantidad de días indicada supera los días del mes.",
    "A day count exceeds the number of days in that month.",
  ],
  INCONSISTENT_DAILY_BALANCES: [
    "Hay contradicciones entre saldos diarios y días negativos.",
    "Daily balances and negative-day counts are inconsistent.",
  ],
  MISSING_STATEMENT: [
    "La IA no incluyó todos los extractos en el detalle mensual.",
    "The AI did not include every statement in its monthly breakdown.",
  ],
  UNKNOWN_LENDER: [
    "Una recomendación no coincide con el directorio de lenders del expediente.",
    "A recommendation does not match the case's lender directory.",
  ],
  LENDER_GUIDELINE_CONFLICT: [
    "Una recomendación contradice guidelines confirmados de un lender.",
    "A recommendation conflicts with a lender's confirmed guidelines.",
  ],
  MISSING_MERCHANT_EVIDENCE: [
    "Revisar el respaldo documental de crédito, antigüedad, impuestos o historial de posiciones.",
    "Review source evidence for credit, business age, taxes or position history.",
  ],
  UNSUPPORTED_SBA_SCREEN: [
    "La sugerencia SBA no está respaldada por todos los criterios configurados.",
    "The SBA suggestion is not supported by all configured criteria.",
  ],
  UNSUPPORTED_TIER_SCREEN: [
    "El tier sugerido no está respaldado por todos los criterios configurados.",
    "The suggested tier is not supported by all configured criteria.",
  ],
  INCONSISTENT_REVENUE: [
    "Las exclusiones superan los depósitos. El cálculo auxiliar de ingresos queda sin confirmar; los valores originales se conservan.",
    "Exclusions exceed deposits. The auxiliary revenue calculation is unconfirmed; original values are preserved.",
  ],
  REPORT_FORMAT: [
    "La respuesta no coincide con el formato esperado. Puedes leer el contenido original y registrar tu revisión.",
    "The response differs from the expected format. Read the original content and record your review.",
  ],
};
export function underwritingWarning(code: string, locale: Locale) {
  return warnings[code]?.[locale === "es" ? 0 : 1] || code;
}
const labels: Record<string, string> = {
  merchant: "Datos del cliente",
  name: "Nombre",
  industry: "Industria",
  credit_score: "Crédito",
  years_in_business: "Años de operación",
  profitable_on_taxes: "Rentabilidad fiscal",
  positions_last_12_months: "Posiciones en 12 meses",
  evidence: "Evidencias",
  document_id: "Archivo",
  page: "Página",
  excerpt: "Cita",
  monthly_financials: "Detalle financiero por extracto",
  period: "Período",
  deposits: "Depósitos",
  funding_deposits: "Depósitos de fondeo",
  internal_transfers: "Transferencias internas",
  other_non_operating_deposits: "Otros depósitos no operativos",
  operating_debits: "Débitos operativos",
  debt_debits: "Débitos de deuda",
  ending_balance: "Saldo final",
  minimum_balance: "Saldo mínimo",
  average_balance: "Saldo promedio",
  negative_balance_days: "Días de saldo negativo",
  net_debit_days: "Días con débitos mayores a depósitos",
  confidence: "Nivel de confirmación",
  positions: "Posiciones MCA",
  funded_amount: "Monto fondeado",
  funding_date: "Fecha de fondeo",
  payment_frequency: "Frecuencia de pago",
  payment_amount: "Monto del pago",
  payment_status: "Estado de pagos",
  notes: "Notas",
  risks: "Riesgos",
  severity: "Severidad",
  title: "Título",
  details: "Detalle",
  sba: "Potencial SBA sugerido por IA",
  status: "Estado",
  reasons: "Motivos",
  missing_evidence: "Evidencia faltante",
  suggested_tier: "Tier sugerido por IA",
  tier_reason: "Motivo del tier",
  lender_matches: "Lenders sugeridos por IA",
  lender_id: "ID del lender",
  reason: "Motivo",
  missing_requirements: "Requisitos pendientes",
  reverse_consolidation: "Reverse consolidation",
  consider: "Considerar",
  summary: "Resumen",
  strategy: "Estrategia",
  client_pitch: "Pitch al cliente",
  crm_notes: "Notas para CRM",
  next_action: "Siguiente acción",
  missing_information: "Información faltante",
  calculated_metrics: "Cálculos auxiliares del CRM",
  true_revenue: "Ingresos operativos calculados",
  available_cash_flow: "Flujo disponible calculado",
  debt_to_revenue: "Deuda / ingresos",
  revenue_to_debt: "Ingresos / deuda",
};
export type UnderwritingLine = {
  text: string;
  heading: boolean;
  depth: number;
};
/** A plain-text document shared by the screen fallback and PDF; no HTML from the model. */
export function underwritingOutputLines(
  output: unknown,
  locale: Locale,
  documents: UnderwritingRun["document_snapshot"] = [],
) {
  const lines: UnderwritingLine[] = [];
  const label = (key: string) =>
    locale === "es"
      ? labels[key] || key.replaceAll("_", " ")
      : key.replaceAll("_", " ");
  function walk(value: unknown, key = "", depth = 0) {
    const name = label(key);
    if (value !== null && typeof value === "object" && depth < 16) {
      if (key) lines.push({ text: name, heading: true, depth });
      const entries = Array.isArray(value)
        ? value.map((v, i) => [String(i + 1), v] as const)
        : Object.entries(value);
      if (!entries.length)
        lines.push({
          text:
            locale === "es" ? "Sin elementos informados" : "No items reported",
          heading: false,
          depth: depth + 1,
        });
      for (const [k, v] of entries) walk(v, k, depth + 1);
      return;
    }
    let text =
      value === null || value === undefined
        ? locale === "es"
          ? "Sin confirmar"
          : "Not confirmed"
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (key === "document_id") {
      const doc = documents.find((d) => d.id === text);
      if (doc)
        text = `${doc.name}${doc.bank_name ? " · " + doc.bank_name : ""} (${doc.id})`;
    }
    lines.push({
      text: (key ? name + ": " : "") + text,
      heading: false,
      depth,
    });
  }
  walk(output);
  return lines;
}
export function underwritingDocumentLines(
  run: UnderwritingRun,
  company: string,
  locale: Locale,
) {
  const es = locale === "es",
    report = run.report;
  const lines: UnderwritingLine[] = [];
  const add = (text: string, heading = false) =>
    lines.push({ text, heading, depth: 0 });
  add(company, true);
  add(`${run.model} | Prompt v${run.prompt_version} | ${run.created_at}`);
  add(
    es ? "Informe de IA para revisión humana" : "AI report for human review",
    true,
  );
  add(
    es
      ? "Las sugerencias y observaciones de la IA no aprueban ni rechazan la solicitud. La decisión corresponde al usuario."
      : "AI suggestions and observations do not approve or reject the submission. The user decides.",
  );
  add(
    (es ? "Estado de revisión: " : "Review status: ") +
      (run.status === "approved"
        ? es
          ? "Aprobado por el usuario"
          : "Approved by user"
        : run.status === "rejected"
          ? es
            ? "Descartado por el usuario"
            : "Discarded by user"
          : es
            ? "Pendiente de decisión del usuario"
            : "Awaiting user decision"),
  );
  if (run.reviewed_at)
    add(`${es ? "Revisado" : "Reviewed"}: ${run.reviewed_at}`);
  if (run.review_notes) add(run.review_notes);
  add(
    es
      ? "Observaciones automáticas para revisar"
      : "Automatic review observations",
    true,
  );
  for (const code of report?.validation_warnings || [])
    add(`${underwritingWarning(code, locale)} [${code}]`);
  if (!report?.validation_warnings?.length)
    add(
      es
        ? "Sin observaciones automáticas registradas. La revisión humana sigue siendo necesaria."
        : "No automatic observations recorded. Human review is still required.",
    );
  add(es ? "Archivos enviados al análisis" : "Source files", true);
  for (const d of run.document_snapshot)
    add(
      `${d.name} | ${d.bank_name || ""} | ${d.period || (es ? "Período por confirmar" : "Period unconfirmed")} | ${d.id}`,
    );
  if (report) {
    add(es ? "Contenido original de la IA" : "Original AI content", true);
    const {
      validation_warnings: _warnings,
      calculated_metrics: _metrics,
      judicial_check: _judicial,
      original_output,
      unstructured: _format,
      ...legacy
    } = report;
    lines.push(
      ...underwritingOutputLines(
        original_output === undefined ? legacy : original_output,
        locale,
        run.document_snapshot,
      ),
    );
    if (report.calculated_metrics?.length) {
      add(
        es ? "Cálculos auxiliares del CRM" : "CRM auxiliary calculations",
        true,
      );
      lines.push(
        ...underwritingOutputLines(
          report.calculated_metrics,
          locale,
          run.document_snapshot,
        ),
      );
    }
  }
  return lines;
}
