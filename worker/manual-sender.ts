export function manualFastSendEnabled(value: string | undefined) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("INVALID_MANUAL_MAIL_FAST_SEND");
}

type Ports = {
  readyAccounts(): Promise<readonly string[]>;
  send(account: string): Promise<unknown>;
  onError(stage: "discover" | "send"): void;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Database claims serialize across processes. This map also avoids duplicate
// work and unbounded outstanding requests inside one process.
export class ManualSendDispatcher {
  private active = new Map<string, Promise<void>>();
  private polling = false;
  private stopped = false;
  private lastScheduled: string | null = null;
  constructor(
    private ports: Ports,
    private concurrency = 4,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
      throw new Error("INVALID_MANUAL_MAIL_CONCURRENCY");
  }
  async poll(): Promise<boolean> {
    if (this.stopped || this.polling) return true;
    this.polling = true;
    try {
      const accounts = await this.ports.readyAccounts();
      if (this.stopped) return true;
      if (
        !Array.isArray(accounts) ||
        accounts.some((a) => typeof a !== "string" || !uuid.test(a))
      )
        throw new Error("INVALID_MANUAL_MAIL_ACCOUNTS");
      const unique = [...new Set(accounts.map((id) => id.toLowerCase()))];
      const next = unique.indexOf(this.lastScheduled ?? "") + 1;
      const ordered = [...unique.slice(next), ...unique.slice(0, next)];
      for (const account of ordered) {
        if (this.stopped || this.active.size >= this.concurrency) break;
        if (this.active.has(account)) continue;
        this.lastScheduled = account;
        const task = Promise.resolve()
          .then(async () => {
            if (!this.stopped) await this.ports.send(account);
          })
          .catch(() => this.ports.onError("send"))
          .finally(() => this.active.delete(account));
        this.active.set(account, task);
      }
      return true;
    } catch {
      this.ports.onError("discover");
      return false;
    } finally {
      this.polling = false;
    }
  }
  async stop() {
    this.stopped = true;
    await Promise.allSettled([...this.active.values()]);
  }
}

export function startManualSender(ports: Ports, pollMs = 750) {
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 5000)
    throw new Error("INVALID_MANUAL_MAIL_POLL");
  const dispatcher = new ManualSendDispatcher(ports);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let drain: Promise<void> | undefined;
  const requestStop = () => {
    stopped = true;
    drain ??= dispatcher.stop();
    if (timer) clearTimeout(timer);
    wake?.();
  };
  const running = (async () => {
    while (!stopped) {
      const healthy = await dispatcher.poll();
      if (stopped) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, healthy ? pollMs : 5000);
      });
      wake = undefined;
      timer = undefined;
    }
  })();
  return {
    requestStop,
    async stop() {
      requestStop();
      await running;
      await drain;
    },
  };
}
