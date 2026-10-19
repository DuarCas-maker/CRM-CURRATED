import { db, checked } from "./db";
import {
  callUnderwritingProvider,
  UnderwritingProviderError,
  underwritingRequest,
  type ProviderDiagnostics,
} from "../src/lib/server/openai-underwriting";
import { prepareUnderwritingDraft } from "../src/lib/underwriting";
import type { UnderwritingDocument } from "../src/lib/underwriting";

export async function processUnderwriting(job: {
  id: string;
  lease_token: string;
  payload: { run_id: string };
}) {
  const client = db();
  const begin = checked(
    await client.rpc("begin_underwriting", {
      run_id: job.payload.run_id,
      job_id: job.id,
      lease: job.lease_token,
    }),
  ) as { action: string };
  if (begin.action !== "prepare") return;
  const run = checked(
    await client
      .from("underwriting_runs")
      .select("*")
      .eq("id", job.payload.run_id)
      .single(),
  )!;
  let diagnostics: ProviderDiagnostics | undefined;
  async function progress(
    stage: string,
    processed?: number,
    metadata?: ProviderDiagnostics,
  ) {
    try {
      const result = await client.rpc("report_underwriting_progress", {
        run_id: run.id,
        job_id: job.id,
        lease: job.lease_token,
        stage,
        processed: processed ?? null,
        diagnostic: metadata || null,
      });
      // A rolling deployment may precede migration 037. Progress must not discard a valid report.
      return result.error ? true : result.data !== false;
    } catch {
      // Progress is best effort; completion still checks the authoritative lease.
      return true;
    }
  }
  try {
    const apiKey = process.env.R_OPENAI_API_KEY?.trim();
    if (!apiKey)
      throw new UnderwritingProviderError("OPENAI_NOT_CONFIGURED");
    const company = checked(
      await client
        .from("opportunities")
        .select("company")
        .eq("id", run.opportunity_id)
        .single(),
    )!;
    const documents: { snapshot: UnderwritingDocument; bytes: Buffer }[] = [];
    let totalBytes = 0;
    if (!(await progress("documents", 0))) return;
    for (const snapshot of run.document_snapshot as UnderwritingDocument[]) {
      const blob = checked(
        await client.storage
          .from("case-documents")
          .download(snapshot.storage_path),
      )!;
      totalBytes += blob.size;
      if (blob.size > 20 * 1024 * 1024 || totalBytes > 40 * 1024 * 1024)
        throw new UnderwritingProviderError("DOCUMENT_SIZE_LIMIT");
      documents.push({
        snapshot,
        bytes: Buffer.from(await blob.arrayBuffer()),
      });
      if (!(await progress("documents", documents.length))) return;
    }
    const body = underwritingRequest({
      model: run.model,
      prompt: run.prompt,
      maxOutputTokens: run.max_output_tokens,
      documents,
      lenders: run.lender_snapshot,
      company: company.company,
      rules: run.rules,
    });
    const started = checked(
      await client.rpc("start_underwriting_api", {
        run_id: run.id,
        job_id: job.id,
        lease: job.lease_token,
      }),
    );
    if (!started) return;
    if (!(await progress("analyzing", documents.length))) return;
    const result = await callUnderwritingProvider(
      body,
      apiKey,
      fetch,
      { retainUnparsed: true },
    );
    diagnostics = result.diagnostics;
    if (!(await progress("validating", documents.length, diagnostics))) return;
    const report = prepareUnderwritingDraft(
      result.value,
      run.document_snapshot,
      run.lender_snapshot,
      run.rules,
    );
    if (!(await progress("saving", documents.length))) return;
    checked(
      await client.rpc("complete_underwriting", {
        run_id: run.id,
        job_id: job.id,
        lease: job.lease_token,
        value: report,
        response: result.responseId,
        input_count: result.inputTokens,
        output_count: result.outputTokens,
        failure: null,
        uncertain: false,
      }),
    );
  } catch (error) {
    if (error instanceof UnderwritingProviderError && error.diagnostics)
      diagnostics = error.diagnostics;
    if (diagnostics) await progress("diagnostics", undefined, diagnostics);
    const code =
      error instanceof UnderwritingProviderError
        ? error.code
        : "UNDERWRITING_PROCESSING_FAILED";
    checked(
      await client.rpc("complete_underwriting", {
        run_id: run.id,
        job_id: job.id,
        lease: job.lease_token,
        value: null,
        response: diagnostics?.responseId || null,
        input_count: diagnostics?.inputTokens ?? null,
        output_count: diagnostics?.outputTokens ?? null,
        failure: code,
        uncertain:
          error instanceof UnderwritingProviderError && error.uncertain,
      }),
    );
  }
}
