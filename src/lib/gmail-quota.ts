import { setTimeout as sleep } from "node:timers/promises";

// New projects have 6,000 units/user/minute and messages.get costs 20 units.
// Leave headroom for other clients and distribute requests instead of bursting.
export class GmailQuotaPacer {
  private slots = new Map<string, number>();
  constructor(private unitsPerMinute = 4500) {
    if (!Number.isFinite(unitsPerMinute) || unitsPerMinute <= 0)
      throw new Error("INVALID_GMAIL_QUOTA_BUDGET");
  }
  reserve(account: string, units: number, now = Date.now()) {
    if (!Number.isFinite(units) || units <= 0)
      throw new Error("INVALID_GMAIL_REQUEST_COST");
    const start = Math.max(now, this.slots.get(account) || 0);
    this.slots.set(
      account,
      start + Math.ceil((units * 60000) / this.unitsPerMinute),
    );
    return start - now;
  }
  async wait(account: string, units: number) {
    const milliseconds = this.reserve(account, units);
    if (milliseconds > 0) await sleep(milliseconds);
  }
}

export function gmailRequestCost(path: string, method = "GET") {
  const resource = path.split("?")[0];
  if (resource === "profile") return 1;
  if (resource === "history") return 2;
  if (resource === "messages" && method === "GET") return 5;
  if (
    /^messages\/[^/]+(?:\/attachments\/[^/]+)?$/.test(resource) &&
    method === "GET"
  )
    return 20;
  return 100;
}
