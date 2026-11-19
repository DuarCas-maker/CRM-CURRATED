export type PipelineReadQueue = <T>(
  read: () => PromiseLike<T> | T,
) => Promise<T>;

/** Keep the existing per-relation cap as well as the reader's shared budget. */
export async function readPipelineBatches<I, T>(
  batches: I[],
  run: PipelineReadQueue,
  read: (batch: I) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  for (let start = 0; start < batches.length; start += 4) {
    results.push(
      ...(await Promise.all(
        batches.slice(start, start + 4).map((batch) => run(() => read(batch))),
      )),
    );
  }
  return results;
}

/** One budget per reader invocation. No cache or state is shared across users. */
export function createPipelineReadQueue(): PipelineReadQueue {
  const pending: { start: () => void; reject: (reason: unknown) => void }[] =
    [];
  let active = 0;
  let failed = false;
  let failure: unknown;
  function drain() {
    while (!failed && active < 6 && pending.length) {
      active++;
      pending.shift()!.start();
    }
  }
  return <T>(read: () => PromiseLike<T> | T) =>
    new Promise<T>((resolve, reject) => {
      if (failed) {
        reject(failure);
        return;
      }
      pending.push({
        reject,
        start: () => {
          void Promise.resolve()
            .then(read)
            .then(resolve, (error: unknown) => {
              failed = true;
              failure = error;
              for (const job of pending.splice(0)) job.reject(error);
              reject(error);
            })
            .finally(() => {
              active--;
              drain();
            });
        },
      });
      drain();
    });
}
