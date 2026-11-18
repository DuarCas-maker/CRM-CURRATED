import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { syncSelectedMailbox } from "../src/lib/server/mail-transport/mailbox-sync";
import type { RuntimeDependencies } from "../src/lib/server/mail-transport/runtime-context";
import {
  simpleMailboxSchedule,
  scheduleMailboxJobs,
} from "../worker/gmail-schedule";

test("hybrid scheduler continues Composio-only reception and removes stale managed legacy credentials", async () => {
  const previous = process.env.GMAIL_SYNC_MODE;
  process.env.GMAIL_SYNC_MODE = "pubsub";
  const legacy = randomUUID(),
    direct = randomUUID(),
    comp = randomUUID(),
    paused = randomUUID();
  const jobs: any[] = [];
  const deps = {
    composioEnabled: true,
    rpc: async (name: string) =>
      name === "simple_mail_managed_accounts"
        ? [direct, comp, paused]
        : [
            {
              account_id: direct,
              provider: "gmail_oauth",
              route_revision: 2,
              receive_enabled: true,
              watch_expires_at: null,
            },
            {
              account_id: comp,
              provider: "composio",
              route_revision: 3,
              receive_enabled: true,
              watch_expires_at: null,
            },
          ],
  } as unknown as RuntimeDependencies;
  try {
    const merged = await simpleMailboxSchedule(
      [legacy, direct, paused].map((account_id) => ({
        account_id,
        watch_expires_at: null,
      })),
      deps,
    );
    assert.deepEqual(
      merged.map((a) => a.account_id),
      [legacy, direct, comp],
    );
    await scheduleMailboxJobs(merged, async (job) => {
      jobs.push(job);
    });
    assert.equal(
      jobs.filter(
        (j) => j.kind === "gmail_sync" && j.payload.account_id === comp,
      ).length,
      1,
    );
    assert.equal(
      jobs.filter(
        (j) => j.kind === "gmail_watch" && j.payload.account_id === comp,
      ).length,
      0,
    );
    assert.equal(jobs.filter((j) => j.payload.account_id === paused).length, 0);
    assert.equal(
      jobs.filter(
        (j) => j.kind === "gmail_sync" && j.payload.account_id === direct,
      ).length,
      1,
    );
  } finally {
    if (previous === undefined) delete process.env.GMAIL_SYNC_MODE;
    else process.env.GMAIL_SYNC_MODE = previous;
  }
});

test("new mailbox uses exactly thirty-day floor and releases cycle on malformed floor", async () => {
  const previous = process.env.SIMPLE_MAIL_ENABLED;
  process.env.SIMPLE_MAIL_ENABLED = "true";
  const account = randomUUID(),
    cycle = randomUUID(),
    floor = "2026-10-18T12:00:00Z";
  let invalid = false;
  const paths: string[] = [],
    calls: string[] = [];
  const deps: RuntimeDependencies = {
    composioEnabled: false,
    configuration: () => null,
    now: () => Date.parse("2026-11-17T12:00:00Z"),
    fetchImpl: async () => {
      throw Error("NO_NETWORK");
    },
    rpc: async (name) => {
      calls.push(name);
      if (name === "simple_mail_managed") return true;
      if (name === "simple_mail_recover_sync") return 0;
      if (name === "simple_mail_initial_begin")
        return { baseline: "123", page: null, done: false };
      if (name === "simple_mail_initial_advance") return null;
      if (name === "mail_sync_begin")
        return {
          id: cycle,
          account_id: account,
          provider: "gmail_oauth",
          revision: 1,
          email: "new@example.test",
          history_id: null,
          since: "2026-11-16T12:00:00Z",
          deadline: "2026-11-17T12:15:00Z",
        };
      if (name === "simple_mail_sync_floor")
        return invalid ? "bad-timestamp" : floor;
      if (name === "mail_sync_validate") return true;
      if (name === "mail_sync_complete" || name === "mail_sync_abort")
        return null;
      throw Error("UNEXPECTED_RPC");
    },
  };
  const ports = {
    request: async <R>(path: string): Promise<R> => {
      paths.push(path);
      return (
        path === "profile" ? { historyId: "123" } : { messages: [] }
      ) as R;
    },
    ingest: async () => {
      throw Error("NO_MESSAGES_EXPECTED");
    },
  };
  try {
    await syncSelectedMailbox(account, 1, deps, ports);
    const query = new URLSearchParams(
      paths.find((p) => p.startsWith("messages?"))!.split("?")[1],
    );
    assert.match(
      query.get("q")!,
      new RegExp(`^after:${Date.parse(floor) / 1000} `),
    );
    assert.ok(calls.includes("simple_mail_initial_advance"));
    invalid = true;
    paths.length = 0;
    calls.length = 0;
    await assert.rejects(
      syncSelectedMailbox(account, 1, deps, ports),
      /R06_UNAVAILABLE/,
    );
    assert.ok(calls.includes("mail_sync_abort"));
    assert.equal(paths.length, 0);
  } finally {
    if (previous === undefined) delete process.env.SIMPLE_MAIL_ENABLED;
    else process.env.SIMPLE_MAIL_ENABLED = previous;
  }
});

test("thirty-day import resumes saved pages, retries an interrupted page and commits its original baseline", async () => {
  const previous = process.env.SIMPLE_MAIL_ENABLED;
  process.env.SIMPLE_MAIL_ENABLED = "true";
  const account = randomUUID();
  let page: string | null = null,
    savedBaseline: string | null = null,
    checkpoint: string | null = null,
    profile = 100,
    fail = true;
  const pages: (string | null)[] = [],
    ingested = new Set<string>();
  const deps: RuntimeDependencies = {
    composioEnabled: false,
    configuration: () => null,
    now: () => Date.parse("2026-11-17T12:00:00Z"),
    fetchImpl: async () => {
      throw Error("NO_NETWORK");
    },
    rpc: async (name, p) => {
      if (name === "mail_sync_begin")
        return {
          id: randomUUID(),
          account_id: account,
          provider: "gmail_oauth",
          revision: 1,
          email: "batch@example.test",
          history_id: checkpoint,
          since: "2026-11-16T12:00:00Z",
          deadline: "2026-11-17T12:15:00Z",
        };
      if (name === "simple_mail_recover_sync") return 0;
      if (name === "simple_mail_managed" || name === "mail_sync_validate")
        return true;
      if (name === "simple_mail_sync_floor") return "2026-10-18T12:00:00Z";
      if (name === "simple_mail_initial_begin") {
        savedBaseline ??= String(p.baseline);
        return { baseline: savedBaseline, page, done: false };
      }
      if (name === "simple_mail_initial_advance") {
        assert.equal(p.expected_page, page);
        page = p.next_page as string | null;
        if (page === null) checkpoint = savedBaseline;
        return null;
      }
      if (name === "mail_sync_abort") return null;
      throw Error("UNEXPECTED_RPC:" + name);
    },
  };
  const ports = {
    request: async <R>(path: string): Promise<R> => {
      if (path === "profile") return { historyId: String(++profile) } as R;
      if (path.startsWith("messages?")) {
        const token = new URLSearchParams(path.split("?")[1]).get("pageToken");
        pages.push(token);
        return (
          token
            ? { messages: [{ id: "bb" }] }
            : { messages: [{ id: "aa" }], nextPageToken: "page-two" }
        ) as R;
      }
      return { id: path.split("/")[1].split("?")[0] } as R;
    },
    ingest: async (_a: unknown, m: { id: string }) => {
      if (m.id === "bb" && fail) {
        fail = false;
        throw Error("FICTIONAL_INGEST_INTERRUPTED");
      }
      ingested.add(m.id);
    },
  };
  try {
    await syncSelectedMailbox(account, 1, deps, ports);
    assert.equal(page, "page-two");
    assert.equal(checkpoint, null);
    await assert.rejects(
      syncSelectedMailbox(account, 1, deps, ports),
      /FICTIONAL_INGEST_INTERRUPTED/,
    );
    assert.equal(page, "page-two");
    await syncSelectedMailbox(account, 1, deps, ports);
    assert.deepEqual(pages, [null, "page-two", "page-two"]);
    assert.equal(checkpoint, "101");
    assert.equal(ingested.size, 2);
  } finally {
    if (previous === undefined) delete process.env.SIMPLE_MAIL_ENABLED;
    else process.env.SIMPLE_MAIL_ENABLED = previous;
  }
});
