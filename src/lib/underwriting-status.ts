import type { Document, Locale } from "./domain";
import type { UnderwritingRun } from "./underwriting";

export function underwritingReadiness(documents: Document[], demo = false) {
  const docs = documents.filter((d) => d.kind !== "analysis_report");
  const usable = (d: Document) =>
    d.status === "approved" && (demo || !!(d.storage_path && d.content_hash));
  const applications = docs.filter((d) => d.kind === "application");
  const banks = docs
    .filter((d) => d.kind === "bank_statement")
    .sort(
      (a, b) =>
        (a.bank_name || "").localeCompare(b.bank_name || "") ||
        (a.statement_number || 0) - (b.statement_number || 0) ||
        a.id.localeCompare(b.id),
    );
  const seen = new Set<string>();
  const bankRows = banks.map((doc, index) => {
    const key = doc.content_hash || (demo ? doc.id : "");
    const duplicate = usable(doc) && !!key && seen.has(key);
    if (usable(doc) && key) seen.add(key);
    return {
      id: doc.id,
      doc,
      number: doc.statement_number || index + 1,
      ready: usable(doc) && !duplicate,
      duplicate,
    };
  });
  const required = docs.filter(
    (d) => d.required !== false && d.kind !== "bank_statement",
  );
  const approvedBanks = bankRows.filter((r) => r.ready).length;
  const sourceCount = docs.filter(usable).length;
  const applicationReady = applications.some(usable);
  return {
    applicationReady,
    approvedBanks,
    banksReady: approvedBanks >= 4,
    bankRows,
    required,
    sourceCount,
    sourcesWithinLimit: sourceCount <= 24,
    ready:
      applicationReady &&
      approvedBanks >= 4 &&
      required.every(usable) &&
      sourceCount <= 24,
    usable,
  };
}

const stages: Record<string, [string, string, number]> = {
  queued: ["En cola para iniciar", "Queued to start", 0],
  preparing: [
    "Preparando archivos y configuración",
    "Preparing files and settings",
    5,
  ],
  documents: [
    "Comprobando y descargando documentos",
    "Checking and downloading documents",
    10,
  ],
  analyzing: [
    "OpenAI está analizando los documentos",
    "OpenAI is analyzing the documents",
    50,
  ],
  validating: [
    "Validando cálculos, evidencias y lenders",
    "Validating calculations, evidence and lenders",
    85,
  ],
  saving: ["Guardando el borrador", "Saving the draft", 95],
  complete: ["Borrador listo para revisión", "Draft ready for review", 100],
};
export function underwritingProgress(run: UnderwritingRun, locale: Locale) {
  const complete = ["draft", "approved"].includes(run.status);
  const stopped = ["failed", "uncertain", "outdated"].includes(run.status);
  const stage = complete
    ? "complete"
    : stages[run.progress_stage || ""]
      ? run.progress_stage!
      : run.status === "running"
        ? "analyzing"
        : run.status === "preparing"
          ? "preparing"
          : "queued";
  const definition = stages[stage];
  const percent = complete
    ? 100
    : Math.min(
        95,
        Math.max(
          0,
          Number.isFinite(run.progress_percent)
            ? run.progress_percent!
            : definition[2],
        ),
      );
  return {
    stage,
    percent,
    complete,
    stopped,
    active: !complete && !stopped,
    label: stopped
      ? locale === "es"
        ? "El análisis se detuvo; revisa el motivo."
        : "Analysis stopped; review the reason."
      : definition[locale === "es" ? 0 : 1],
    processed: Math.max(
      0,
      Math.min(run.document_snapshot.length, run.documents_processed || 0),
    ),
    total: run.document_snapshot.length,
  };
}

const errors: Record<string, [string, string, string, string]> = {
  OPENAI_OUTPUT_LIMIT_REACHED: [
    "OpenAI alcanzó el límite de respuesta antes de terminar el informe.",
    "OpenAI reached the output limit before finishing the report.",
    "Revisa el límite de tokens en Configuración → Análisis y underwriting antes de solicitar un nuevo análisis. Puedes pasar de 8.000 a 16.000 o hasta 32.000. Si ya usas el máximo, revisa la extensión del prompt y del informe. Un límite mayor puede aumentar el consumo.",
    "Review the token limit in Settings → Analysis and underwriting before requesting a new analysis. You can increase 8,000 to 16,000 or up to 32,000. If already at the maximum, review prompt and report length. A larger limit may increase usage.",
  ],
  OPENAI_CONTENT_FILTER: [
    "OpenAI no pudo completar la respuesta por un filtro de contenido.",
    "OpenAI could not complete the response because of a content filter.",
    "Revisa los archivos y el prompt. No se ha guardado un informe parcial ni se ha repetido el envío.",
    "Review the files and prompt. No partial report was saved or automatically resent.",
  ],
  OPENAI_INCOMPLETE_RESPONSE: [
    "OpenAI no terminó la respuesta. Esta ejecución no conserva un motivo específico.",
    "OpenAI did not finish the response. This run has no specific saved reason.",
    "Revisa el límite de tokens en Configuración → Análisis y underwriting. Si está en 8.000, considera 16.000 antes de solicitar un nuevo análisis; puede aumentar el consumo.",
    "Review the token limit in Settings → Analysis and underwriting. If it is 8,000, consider 16,000 before requesting a new analysis; usage may increase.",
  ],
  OPENAI_RESULT_UNCERTAIN: [
    "No se pudo confirmar el resultado de la solicitud.",
    "The request result could not be confirmed.",
    "Revisa el estado antes de repetirla: OpenAI puede haber procesado la solicitud. No habrá reintento automático.",
    "Check its status before repeating: OpenAI may have processed it. There is no automatic retry.",
  ],
  OPENAI_QUOTA_EXHAUSTED: [
    "La cuenta de OpenAI no tiene cuota disponible.",
    "The OpenAI account has no available quota.",
    "Revisa el saldo y la facturación de la API antes de volver a analizar.",
    "Review API balance and billing before analyzing again.",
  ],
  OPENAI_LIMIT_REACHED: [
    "OpenAI limitó temporalmente las solicitudes.",
    "OpenAI temporarily rate-limited requests.",
    "Espera y vuelve a solicitar el análisis cuando se libere el límite.",
    "Wait and request the analysis again when the rate limit clears.",
  ],
  OPENAI_AUTH_FAILED: [
    "OpenAI rechazó la autenticación.",
    "OpenAI rejected authentication.",
    "El administrador debe revisar la clave de OpenAI del worker.",
    "The administrator must check the worker's OpenAI key.",
  ],
  OPENAI_RESPONSE_REFUSED: [
    "OpenAI no pudo generar este informe.",
    "OpenAI could not generate this report.",
    "Revisa los documentos y el prompt con el equipo.",
    "Review the documents and prompt with the team.",
  ],
  DOCUMENTS_CHANGED: [
    "Los documentos cambiaron durante el análisis.",
    "Documents changed during analysis.",
    "Revisa y aprueba las versiones actuales antes de generar otro borrador.",
    "Review and approve the current versions before generating another draft.",
  ],
  UNDERWRITING_REPORT_REQUIRES_REVIEW: [
    "El informe no superó la validación de cálculos o evidencias.",
    "The report did not pass calculation or evidence validation.",
    "Revisa las fuentes y los datos faltantes antes de solicitar otro análisis.",
    "Review source files and missing data before requesting another analysis.",
  ],
};
export function underwritingError(code: string, locale: Locale) {
  const value = errors[code] || [
    "No se pudo completar el análisis.",
    "The analysis could not be completed.",
    "Revisa la configuración y los documentos. Comparte el código técnico con el administrador si continúa.",
    "Review settings and documents. Share the technical code with the administrator if it persists.",
  ];
  return {
    message: value[locale === "es" ? 0 : 1],
    action: value[locale === "es" ? 2 : 3],
  };
}
