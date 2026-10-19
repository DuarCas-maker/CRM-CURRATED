export const AI_SERVICE_KEYS = {
  risk_analysis: "R_OPENAI_API_KEY",
  application_extraction: "A_OPENAI_API_KEY",
  document_classification: "D_OPENAI_API_KEY",
} as const;
export type AiService = keyof typeof AI_SERVICE_KEYS;
export const AI_SERVICE_LABELS: Record<AiService, [string, string]> = {
  risk_analysis: ["Análisis de riesgo", "Risk analysis"],
  application_extraction: ["Completar aplicación", "Application extraction"],
  document_classification: [
    "Identificar documentos",
    "Document identification",
  ],
};
export type AiUsageSummary = {
  service: AiService;
  model: string;
  calls: number;
  completed: number;
  failed: number;
  uncertain: number;
  started: number;
  unknown_usage: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number;
};
export type AiUsageEvent = {
  id: string;
  service: AiService;
  credential_name: string;
  model: string;
  status: "started" | "completed" | "failed" | "uncertain";
  started_at: string;
  finished_at: string | null;
  opportunity_id: string | null;
  actor_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  error_code: string | null;
  provider_response_id: string | null;
};
