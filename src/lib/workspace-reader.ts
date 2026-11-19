// One active GET per mounted workspace. Never cache across users or retry writes.
export class WorkspaceReader<T> {
  private version = 0;
  private active?: {
    url: string;
    controller: AbortController;
    promise: Promise<T | undefined>;
  };

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  cancel() {
    this.version++;
    this.active?.controller.abort();
    this.active = undefined;
  }

  read(url: string, replace = false): Promise<T | undefined> {
    if (!replace && this.active?.url === url) return this.active.promise;
    this.cancel();
    const version = this.version;
    const controller = new AbortController();
    let timedOut = false;
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const promise = (async () => {
      try {
        const request = async () => {
          const response = await this.fetchImpl.call(globalThis, url, {
            signal: controller.signal,
            cache: "no-store",
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(
              typeof body.error === "string"
                ? body.error
                : "No se pudo actualizar / Could not refresh",
            );
          return body as T;
        };
        const body = await Promise.race([request(), aborted]);
        return version === this.version ? body : undefined;
      } catch (error) {
        if (version !== this.version) return undefined;
        if (timedOut)
          throw new Error(
            "La carga tardó demasiado. Intenta actualizar de nuevo. / Loading took too long. Try refreshing again.",
          );
        throw error;
      } finally {
        clearTimeout(timer);
        if (version === this.version) this.active = undefined;
      }
    })();
    this.active = { url, controller, promise };
    return promise;
  }
}
