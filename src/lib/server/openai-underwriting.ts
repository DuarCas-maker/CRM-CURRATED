import { z } from "zod";
import { underwritingReportSchema } from "../underwriting";
import { DEFAULT_UNDERWRITING_RULES } from "../underwriting";
import type { UnderwritingDocument } from "../underwriting";
import { previewMime } from "../document-review";
import { hash } from "./crypto";

export class UnderwritingProviderError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
  ) {
    super(code);
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
    underwritingReportSchema,
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
      "\nThe supplied structured screening_rules are the authoritative numerical criteria, overriding any older numerical thresholds in the prompt. They are internal screening rules, not verified lender or SBA eligibility policies. Analyze every supplied bank statement, across every bank. When a manifest period is empty, extract its YYYY-MM period from the file and cite the evidence; never infer it from the numbered filename. Different documents and banks may share the same period. Flag missing periods or insufficient month coverage for the human reviewer.",
    store: false,
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
) {
  if (!apiKey) throw new UnderwritingProviderError("OPENAI_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
  } catch {
    throw new UnderwritingProviderError("OPENAI_RESULT_UNCERTAIN", true);
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    const code =
      failure?.error?.code === "insufficient_quota"
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
  let payload: {
    id?: string;
    status?: string;
    usage?: { input_tokens: number; output_tokens: number };
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  try {
    payload = await response.json();
  } catch {
    throw new UnderwritingProviderError("OPENAI_INVALID_RESPONSE", true);
  }
  if (payload.status !== "completed")
    throw new UnderwritingProviderError("OPENAI_INCOMPLETE_RESPONSE");
  const output = payload.output?.flatMap((o) => o.content || []) || [];
  if (output.some((c) => c.type === "refusal"))
    throw new UnderwritingProviderError("OPENAI_RESPONSE_REFUSED");
  const text = output
    .filter((c) => c.type === "output_text")
    .map((c) => c.text || "")
    .join("");
  if (text.length > 1000000)
    throw new UnderwritingProviderError("OPENAI_OUTPUT_TOO_LARGE");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UnderwritingProviderError("OPENAI_INVALID_REPORT");
  }
  return {
    value,
    responseId: payload.id || null,
    inputTokens: payload.usage?.input_tokens || 0,
    outputTokens: payload.usage?.output_tokens || 0,
  };
}
