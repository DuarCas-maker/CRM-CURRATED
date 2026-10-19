import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_SERVICE_KEYS, type AiService } from "../ai-usage";
import type { ProviderDiagnostics } from "./openai-underwriting";

export function aiApiKey(service: AiService) {
  return process.env[AI_SERVICE_KEYS[service]]?.trim() || undefined;
}
export type AiUsageContext = {
  db: SupabaseClient;
  service: AiService;
  opportunityId: string;
  actorId: string | null;
  underwritingRunId?: string;
};
export class AiUsageUnavailable extends Error {
  constructor() {
    super("AI_USAGE_UNAVAILABLE");
  }
}
/** Persist the attempt before sending bytes; finalization never resends a paid call. */
export async function trackAiUsage<
  T extends { diagnostics: ProviderDiagnostics },
>(
  context: AiUsageContext,
  model: string,
  request: () => Promise<T>,
): Promise<T> {
  const id = randomUUID(),
    started = Date.now();
  try {
    const result = await context.db.from("ai_usage_events").insert({
      id,
      service: context.service,
      model,
      opportunity_id: context.opportunityId,
      actor_id: context.actorId,
      underwriting_run_id: context.underwritingRunId || null,
    });
    if (result.error) throw new AiUsageUnavailable();
  } catch {
    throw new AiUsageUnavailable();
  }
  async function finish(
    status: "completed" | "failed" | "uncertain",
    diagnostics?: ProviderDiagnostics,
    errorCode: string | null = null,
  ) {
    try {
      const result = await context.db.rpc("finish_ai_usage_event", {
        event_id: id,
        result: {
          status,
          provider_response_id: diagnostics?.responseId ?? null,
          input_tokens: diagnostics?.inputTokens ?? null,
          output_tokens: diagnostics?.outputTokens ?? null,
          cached_input_tokens: diagnostics?.cachedInputTokens ?? null,
          reasoning_tokens: diagnostics?.reasoningTokens ?? null,
          duration_ms: Math.min(2147483647, Math.max(0, Date.now() - started)),
          error_code: errorCode,
        },
      });
      if (result.error || result.data !== true) throw new Error();
    } catch {
      // Keep the durable started row with unknown usage. Do not discard an AI result
      // or reissue a chargeable request because accounting finalization was unavailable.
      console.error("AI_USAGE_FINALIZATION_PENDING", {
        eventId: id,
        service: context.service,
        status,
        diagnostics,
        errorCode,
      });
    }
  }
  let response: T;
  try {
    response = await request();
  } catch (error) {
    const failure = error as {
      code?: string;
      uncertain?: boolean;
      diagnostics?: ProviderDiagnostics;
    } | null;
    const code =
      typeof failure?.code === "string" &&
      /^OPENAI_[A-Z_]{1,80}$/.test(failure.code)
        ? failure.code
        : "OPENAI_CALL_FAILED";
    await finish(
      failure?.uncertain ? "uncertain" : "failed",
      failure?.diagnostics,
      code,
    );
    throw error;
  }
  await finish("completed", response.diagnostics);
  return response;
}
