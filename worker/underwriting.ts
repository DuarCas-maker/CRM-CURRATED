import { db, checked } from "./db";
import {
  callUnderwritingProvider,
  UnderwritingProviderError,
  underwritingRequest,
} from "../src/lib/server/openai-underwriting";
import { validateUnderwritingReport } from "../src/lib/underwriting";
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
  try {
    if (!process.env.OPENAI_API_KEY)
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
    const result = await callUnderwritingProvider(
      body,
      process.env.OPENAI_API_KEY,
    );
    const report = validateUnderwritingReport(
      result.value,
      run.document_snapshot,
      run.lender_snapshot,
      run.rules,
    );
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
    const code =
      error instanceof UnderwritingProviderError
        ? error.code
        : "UNDERWRITING_REPORT_REQUIRES_REVIEW";
    checked(
      await client.rpc("complete_underwriting", {
        run_id: run.id,
        job_id: job.id,
        lease: job.lease_token,
        value: null,
        response: null,
        input_count: null,
        output_count: null,
        failure: code,
        uncertain:
          error instanceof UnderwritingProviderError && error.uncertain,
      }),
    );
  }
}
