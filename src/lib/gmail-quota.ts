import { setTimeout as sleep } from "node:timers/promises";

// New projects have 6,000 units/user/minute and messages.get costs 20 units.
// Leave headroom for other clients and distribute requests instead of bursting.
export class GmailQuotaPacer {
  private slots = new Map<string, number>();
  private budgets = new Map<string, number>();
  constructor(private unitsPerMinute = 4500) {
    if (!Number.isFinite(unitsPerMinute) || unitsPerMinute <= 0)
      throw new Error("INVALID_GMAIL_QUOTA_BUDGET");
  }
  budget(account: string) {
    return this.budgets.get(account) ?? this.unitsPerMinute;
  }
  throttle(account: string) {
    const reduced = Math.max(
      Math.min(600, this.unitsPerMinute),
      Math.floor(this.budget(account) / 2),
    );
    this.budgets.set(account, reduced);
    return reduced;
  }
  reserve(account: string, units: number, now = Date.now()) {
    if (!Number.isFinite(units) || units <= 0)
      throw new Error("INVALID_GMAIL_REQUEST_COST");
    const start = Math.max(now, this.slots.get(account) || 0);
    this.slots.set(
      account,
      start + Math.ceil((units * 60000) / this.budget(account)),
    );
    return start - now;
  }
  async wait(account: string, units: number) {
    const milliseconds = this.reserve(account, units);
    if (milliseconds > 0) await sleep(milliseconds);
  }
}

export function gmailRequestOperation(path: string, method = "GET") {
  const resource = path.split("?")[0];
  if (resource === "profile") return "getProfile";
  if (resource === "history") return "history.list";
  if (resource === "messages" && method === "GET") return "messages.list";
  if (
    /^messages\/[^/]+\/attachments\/[^/]+$/.test(resource) &&
    method === "GET"
  )
    return "messages.attachments.get";
  if (/^messages\/[^/]+$/.test(resource) && method === "GET")
    return "messages.get";
  if (resource === "messages/send" && method === "POST") return "messages.send";
  if (resource === "watch") return "watch";
  return "other";
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
