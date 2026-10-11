export interface GmailAnalysisCounts {
  status: string;
  resume_status?: string | null;
  scanned: number;
  skipped: number;
  estimated_messages: number;
}

const count = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function gmailAnalysisProgress(run: GmailAnalysisCounts) {
  const saved = count(run.scanned);
  const skipped = count(run.skipped);
  const processed = saved + skipped;
  const estimate = count(run.estimated_messages);
  const complete =
    ["review", "importing", "completed", "undone"].includes(run.status) ||
    (["paused", "failed"].includes(run.status) &&
      run.resume_status === "importing");
  // Gmail supplies an estimate, not a count. Reaching it while the scan is
  // active cannot prove that no more pages remain.
  const exceeded = !complete && estimate > 0 && processed >= estimate;
  const measurable = estimate > processed;
  return {
    saved,
    skipped,
    processed,
    estimate,
    complete,
    exceeded,
    remaining: complete ? 0 : measurable ? estimate - processed : null,
    percent: complete
      ? 100
      : measurable
        ? Math.floor((processed / estimate) * 1000) / 10
        : null,
  };
}
