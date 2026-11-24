/** Operational timings only: never retain request URLs, filters, bodies or identities. */
export async function observeTasksRead<T>(
  read: (fetchImpl: typeof fetch) => Promise<T>,
  fetchImpl: typeof fetch = fetch,
  write: (event: string, data: string) => void = console.info,
): Promise<T> {
  const started = performance.now();
  const reads = new Map<
    string,
    { calls: number; max_ms: number; total_ms: number }
  >();
  let failure: { operation: string; code: string } | undefined;
  const timedFetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const resource = url.pathname.split("/").at(-1) || "unknown";
    const operation = /^[a-z_]+$/.test(resource) ? resource : "other";
    const before = performance.now();
    try {
      return await fetchImpl.call(globalThis, input, init);
    } finally {
      const ms = Math.round(performance.now() - before);
      const sample = reads.get(operation) || {
        calls: 0,
        max_ms: 0,
        total_ms: 0,
      };
      sample.calls++;
      sample.max_ms = Math.max(sample.max_ms, ms);
      sample.total_ms += ms;
      reads.set(operation, sample);
    }
  };
  try {
    return await read(timedFetch);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause && typeof cause === "object") {
      const value = cause as { operation?: string; code?: string };
      failure = {
        operation: /^[a-z_.]+$/.test(value.operation || "")
          ? value.operation!
          : "unknown",
        code: /^[A-Z0-9]+$/.test(value.code || "") ? value.code! : "unknown",
      };
    }
    throw error;
  } finally {
    write(
      "pipeline_tasks_read",
      JSON.stringify({
        duration_ms: Math.round(performance.now() - started),
        failure,
        reads: Object.fromEntries(
          [...reads.entries()].sort((a, b) => b[1].total_ms - a[1].total_ms),
        ),
      }),
    );
  }
}
