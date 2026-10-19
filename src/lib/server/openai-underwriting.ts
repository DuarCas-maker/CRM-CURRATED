import { z } from "zod";
import { underwritingReportSchema } from "../underwriting";
import { DEFAULT_UNDERWRITING_RULES } from "../underwriting";
import type { UnderwritingDocument } from "../underwriting";
import { previewMime } from "../document-review";
import { hash } from "./crypto";
import {
  compactUnderwritingSchema,
  COMPACT_UNDERWRITING_INSTRUCTIONS,
} from "../underwriting-compact";

export class UnderwritingProviderError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
    public diagnostics?: ProviderDiagnostics,
  ) {
    super(code);
  }
}
export type ProviderDiagnostics = {
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  status: string;
  incomplete_reason: string | null;
  max_output_tokens: number | null;
};
export const UNDERWRITING_STREAM_TIMEOUT_MS = 15 * 60 * 1000;
type ProviderResponse = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  max_output_tokens?: number;
  usage?: { input_tokens: number; output_tokens: number };
  output?: { type: string; content?: { type: string; text?: string }[] }[];
};
function providerDiagnostics(
  payload: ProviderResponse,
  limit: unknown,
): ProviderDiagnostics {
  const count = (value: unknown) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2147483647
      ? value
      : null;
  return {
    responseId:
      typeof payload.id === "string" &&
      /^[A-Za-z0-9_-]{1,200}$/.test(payload.id)
        ? payload.id
        : null,
    inputTokens: count(payload.usage?.input_tokens),
    outputTokens: count(payload.usage?.output_tokens),
    status: [
      "completed",
      "incomplete",
      "failed",
      "cancelled",
      "queued",
      "in_progress",
    ].includes(payload.status || "")
      ? payload.status!
      : "unknown",
    incomplete_reason: ["max_output_tokens", "content_filter"].includes(
      payload.incomplete_details?.reason || "",
    )
      ? payload.incomplete_details!.reason!
      : null,
    max_output_tokens: count(payload.max_output_tokens ?? limit),
  };
}
async function readProviderStream(
  response: Response,
  capture: (value: ProviderResponse) => void,
) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new UnderwritingProviderError("OPENAI_STREAM_INTERRUPTED", true);
  const decoder = new TextDecoder();
  let buffer = "",
    totalBytes = 0;
  function event(frame: string): ProviderResponse | undefined {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let value;
    try {
      value = JSON.parse(data);
    } catch {
      throw new UnderwritingProviderError("OPENAI_STREAM_INTERRUPTED", true);
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new UnderwritingProviderError("OPENAI_STREAM_INTERRUPTED", true);
    if (value.type === "error") {
      const failure = value.error || value;
      if (
        failure.type === "insufficient_quota" ||
        ["insufficient_quota", "credit_balance_exhausted"].includes(
          failure.code,
        )
      )
        throw new UnderwritingProviderError("OPENAI_QUOTA_EXHAUSTED", false);
      if (failure.code === "billing_hard_limit_reached")
        throw new UnderwritingProviderError(
          "OPENAI_SPEND_LIMIT_REACHED",
          false,
        );
      if (failure.code === "rate_limit_exceeded")
        throw new UnderwritingProviderError("OPENAI_LIMIT_REACHED", false);
      throw new UnderwritingProviderError("OPENAI_STREAM_INTERRUPTED", true);
    }
    if (
      ![
        "response.created",
        "response.in_progress",
        "response.completed",
        "response.incomplete",
        "response.failed",
      ].includes(value.type)
    )
      return;
    const payload = value.response;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new UnderwritingProviderError("OPENAI_STREAM_INTERRUPTED", true);
    capture(payload);
    // Text deltas can contain partial JSON; only a terminal Response is a report.
    if (
      ["response.completed", "response.incomplete", "response.failed"].includes(
        value.type,
      )
    )
      return payload;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      totalBytes += value?.length || 0;
      if (totalBytes > 16 * 1024 * 1024)
        throw new UnderwritingProviderError("OPENAI_OUTPUT_TOO_LARGE", true);
      buffer += decoder.decode(value, { stream: !done });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        if (boundary.index > 4 * 1024 * 1024)
          throw new UnderwritingProviderError("OPENAI_OUTPUT_TOO_LARGE", true);
        const result = event(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (result) return result;
      }
      if (buffer.length > 4 * 1024 * 1024)
        throw new UnderwritingProviderError("OPENAI_OUTPUT_TOO_LARGE", true);
      if (done) {
        const result = event(buffer);
        if (result) return result;
        throw new UnderwritingProviderError("OPENAI_STREAM_INTERRUPTED", true);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function underwritingRequest(options: {
  model: string;
  prompt: string;
  maxOutputTokens: number;
  documents: { snapshot: UnderwritingDocument; bytes: Buffer }[];
  lenders: unknown;
  company: string;
  rules?: unknown;
}) {
  const { $schema: _schema, ...schema } = z.toJSONSchema(
    underwritingReportSchema.extend({
      compact_report: compactUnderwritingSchema,
    }),
  );
  const content: Record<string, unknown>[] = [
    {
      type: "input_text",
      text: JSON.stringify({
        company: options.company,
        screening_rules: options.rules || DEFAULT_UNDERWRITING_RULES,
        document_manifest: options.documents.map((d) => ({
          document_id: d.snapshot.id,
          filename: d.snapshot.name,
          kind: d.snapshot.kind,
          period: d.snapshot.period,
          bank_name: d.snapshot.bank_name || null,
          statement_number: d.snapshot.statement_number || null,
        })),
        lender_catalog: options.lenders,
      }),
    },
  ];
  let total = 0;
  for (const { snapshot, bytes } of options.documents) {
    total += bytes.length;
    if (
      !bytes.length ||
      bytes.length > 20 * 1024 * 1024 ||
      total > 40 * 1024 * 1024
    )
      throw new UnderwritingProviderError("DOCUMENT_SIZE_LIMIT");
    if (hash(bytes) !== snapshot.content_hash)
      throw new UnderwritingProviderError("DOCUMENT_HASH_MISMATCH");
    const mime = previewMime(bytes);
    if (!mime) throw new UnderwritingProviderError("UNSUPPORTED_DOCUMENT_TYPE");
    content.push({
      type: "input_text",
      text: `Document ID: ${snapshot.id}; kind: ${snapshot.kind}; period: ${snapshot.period}. Cite this document ID.`,
    });
    if (mime === "application/pdf")
      content.push({
        type: "input_file",
        filename: `${snapshot.id}.pdf`,
        file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
      });
    else
      content.push({
        type: "input_image",
        image_url: `data:${mime};base64,${bytes.toString("base64")}`,
        detail: "high",
      });
  }
  if (options.documents.length > 24)
    throw new UnderwritingProviderError("DOCUMENT_COUNT_LIMIT");
  return {
    model: options.model,
    reasoning: { effort: "low" },
    instructions:
      options.prompt +
      "\nThe supplied structured screening_rules are the authoritative numerical criteria, overriding any older numerical thresholds in the prompt. They are internal screening rules, not verified lender or SBA eligibility policies. Analyze every supplied bank statement, across every bank. When a manifest period is empty, extract its YYYY-MM period from the file and cite the evidence; never infer it from the numbered filename. Different documents and banks may share the same period. Flag missing periods or insufficient month coverage for the human reviewer. Keep the report concise without omitting any statement, detected position, calculation, material risk or requested section. Use short evidence excerpts (up to 160 characters) and normally 1-3 references per item; avoid repeating full transactions or document text. Recommend only realistically relevant catalog lenders rather than reproducing the whole lender catalog. Return the complete JSON report within the output budget." +
      COMPACT_UNDERWRITING_INSTRUCTIONS,
    store: false,
    stream: true,
    max_output_tokens: options.maxOutputTokens,
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "mca_underwriting",
        strict: true,
        schema,
      },
    },
  };
}
export async function callUnderwritingProvider(
  body: {
    model: string;
    input: unknown[];
    store: boolean;
    text: unknown;
    [key: string]: unknown;
  },
  apiKey: string,
  fetcher: typeof fetch = fetch,
  options: { timeoutMs?: number; retainUnparsed?: boolean } = {},
) {
  if (!apiKey) throw new UnderwritingProviderError("OPENAI_NOT_CONFIGURED");
  const signal = AbortSignal.timeout(
    options.timeoutMs ??
      (body.stream === true ? UNDERWRITING_STREAM_TIMEOUT_MS : 180000),
  );
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new UnderwritingProviderError(
      signal.aborted ? "OPENAI_RESPONSE_TIMEOUT" : "OPENAI_RESULT_UNCERTAIN",
      true,
    );
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    const code = ["insufficient_quota", "credit_balance_exhausted"].includes(
      failure?.error?.code || "",
    )
      ? "OPENAI_QUOTA_EXHAUSTED"
      : failure?.error?.code === "billing_hard_limit_reached"
        ? "OPENAI_SPEND_LIMIT_REACHED"
        : response.status === 401
          ? "OPENAI_AUTH_FAILED"
          : response.status === 429
            ? "OPENAI_LIMIT_REACHED"
            : response.status === 403 || response.status === 404
              ? "OPENAI_ACCESS_DENIED"
              : response.status === 400
                ? "OPENAI_REQUEST_REJECTED"
                : "OPENAI_PROVIDER_FAILED";
    throw new UnderwritingProviderError(code, response.status >= 500);
  }
  let payload: ProviderResponse;
  let accepted: ProviderDiagnostics | undefined;
  const streaming =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
    "text/event-stream";
  try {
    payload = streaming
      ? await readProviderStream(response, (value) => {
          accepted = providerDiagnostics(value, body.max_output_tokens);
        })
      : await response.json();
  } catch (error) {
    if (error instanceof UnderwritingProviderError) {
      error.diagnostics ??= accepted;
      throw error;
    }
    throw new UnderwritingProviderError(
      signal.aborted
        ? "OPENAI_RESPONSE_TIMEOUT"
        : streaming
          ? "OPENAI_STREAM_INTERRUPTED"
          : "OPENAI_INVALID_RESPONSE",
      true,
      accepted,
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new UnderwritingProviderError("OPENAI_INVALID_RESPONSE", true);
  const diagnostics = providerDiagnostics(payload, body.max_output_tokens);
  if (payload.status !== "completed") {
    const code =
      diagnostics.incomplete_reason === "max_output_tokens"
        ? "OPENAI_OUTPUT_LIMIT_REACHED"
        : diagnostics.incomplete_reason === "content_filter"
          ? "OPENAI_CONTENT_FILTER"
          : payload.status === "failed"
            ? "OPENAI_RESPONSE_FAILED"
            : ["queued", "in_progress"].includes(payload.status || "")
              ? "OPENAI_RESULT_UNCERTAIN"
              : "OPENAI_INCOMPLETE_RESPONSE";
    throw new UnderwritingProviderError(
      code,
      ["queued", "in_progress"].includes(payload.status || ""),
      diagnostics,
    );
  }
  if (
    !Array.isArray(payload.output) ||
    payload.output.some(
      (o) =>
        !o ||
        typeof o !== "object" ||
        (o.content != null && !Array.isArray(o.content)),
    )
  )
    throw new UnderwritingProviderError(
      "OPENAI_INVALID_RESPONSE",
      false,
      diagnostics,
    );
  const output = payload.output
    .flatMap((o) => o.content || [])
    .filter((c) => c && typeof c === "object");
  if (output.some((c) => c.type === "refusal"))
    throw new UnderwritingProviderError(
      "OPENAI_RESPONSE_REFUSED",
      false,
      diagnostics,
    );
  const text = output
    .filter((c) => c.type === "output_text")
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .join("");
  if (text.length > 1000000)
    throw new UnderwritingProviderError(
      "OPENAI_OUTPUT_TOO_LARGE",
      false,
      diagnostics,
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    if (options.retainUnparsed && text.trim()) value = text;
    else
      throw new UnderwritingProviderError(
        "OPENAI_INVALID_REPORT",
        false,
        diagnostics,
      );
  }
  return {
    value,
    responseId: diagnostics.responseId,
    inputTokens: diagnostics.inputTokens || 0,
    outputTokens: diagnostics.outputTokens || 0,
    diagnostics,
  };
}
