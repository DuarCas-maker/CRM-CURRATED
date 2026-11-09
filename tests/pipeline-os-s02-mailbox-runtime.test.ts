import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { syncSelectedMailbox } from "../src/lib/server/mail-transport/mailbox-sync";
import {
  selectedMailboxSchedule,
  withSelectedDirectJob,
} from "../src/lib/server/mail-transport/mailbox-schedule";
import {
  executeRuntimeMail,
  withMailRuntime,
  type RuntimeDependencies,
} from "../src/lib/server/mail-transport/runtime-context";
import { withMailboxScope } from "../src/lib/server/mail-transport/mailbox-context";
import { GmailError } from "../src/lib/gmail-errors";
import { scheduleMailboxJobs } from "../worker/gmail-schedule";
function setup(history: string | null = "90071992547409930000") {
  const account = randomUUID(),
    cycle = randomUUID(),
    calls: { name: string; p: Record<string, unknown> }[] = [],
    paths: string[] = [],
    ingested: string[] = [];
  let valid = true;
  const deps: RuntimeDependencies = {
    composioEnabled: true,
    configuration: () => null,
    fetchImpl: async () => {
      throw Error("NO_NETWORK");
    },
    now: () => Date.parse("2026-11-08T12:00:00Z"),
    rpc: async (name, p) => {
      calls.push({ name, p });
      if (name === "mail_sync_begin")
        return {
          id: cycle,
          account_id: account,
          provider: "gmail_oauth",
          revision: 7,
          email: "mailbox@fiction.test",
          history_id: history,
          since: "2026-11-07T12:00:00Z",
          deadline: "2026-11-08T12:15:00Z",
        };
      if (name === "mail_sync_validate") return valid;
      if (name === "mail_sync_abort") return "aborted";
      if (name === "mail_sync_complete") return null;
      throw Error("UNKNOWN_RPC");
    },
  };
  const request = async <R>(path: string): Promise<R> => {
    paths.push(path);
    return (
      path === "profile"
        ? { historyId: "90071992547409939999" }
        : path.startsWith("history?")
          ? { history: [] }
          : { messages: [] }
    ) as R;
  };
  return {
    account,
    cycle,
    deps,
    calls,
    paths,
    ingested,
    request,
    invalidate: () => {
      valid = false;
    },
    ingest: async (_a: unknown, m: { id: string }) => {
      ingested.push(m.id);
    },
  };
}
test("R06-I03 unversioned jobs retire without even opening a cycle", async () => {
  const f = setup();
  await syncSelectedMailbox(f.account, undefined, f.deps, {
    request: f.request,
    ingest: f.ingest,
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.paths.length, 0);
});
test("R06-I03 pagination de-duplicates IDs and commits exact decimal only after all ingestion", async () => {
  const f = setup();
  let historyPages = 0;
  await syncSelectedMailbox(f.account, 7, f.deps, {
    request: async <R>(path: string) => {
      f.paths.push(path);
      if (path === "profile") return { historyId: "90071992547409939999" } as R;
      if (path.startsWith("history?")) {
        historyPages++;
        return {
          history: [
            {
              messagesAdded: [
                { message: { id: "aa" } },
                { message: { id: historyPages === 1 ? "bb" : "aa" } },
              ],
            },
          ],
          ...(historyPages === 1 ? { nextPageToken: "page+two" } : {}),
        } as R;
      }
      assert(!f.calls.some((c) => c.name === "mail_sync_complete"));
      return { id: path.slice(9).split("?")[0] } as R;
    },
    ingest: f.ingest,
  });
  assert.equal(historyPages, 2);
  assert.deepEqual(f.ingested, ["aa", "bb"]);
  assert(f.paths[2].includes("pageToken=page%2Btwo"));
  assert.equal(f.calls.at(-1)?.name, "mail_sync_complete");
  assert.equal(f.calls.at(-1)?.p.checkpoint, "90071992547409939999");
});
test("R06-I03 expired history falls back to bounded query; missing message is skipped", async () => {
  const f = setup();
  await syncSelectedMailbox(f.account, 7, f.deps, {
    request: async <R>(path: string) => {
      f.paths.push(path);
      if (path === "profile") return { historyId: "90071992547409939999" } as R;
      if (path.startsWith("history?")) throw new GmailError(404);
      if (path.startsWith("messages?"))
        return { messages: [{ id: "aa" }, { id: "bb" }] } as R;
      if (path.startsWith("messages/aa")) throw new GmailError(404);
      return { id: "bb" } as R;
    },
    ingest: f.ingest,
  });
  assert.deepEqual(f.ingested, ["bb"]);
  const listing = f.paths.find((p) => p.startsWith("messages?"))!;
  assert.equal(
    new URLSearchParams(listing.split("?")[1]).get("q"),
    `after:${Date.parse("2026-11-06T12:00:00Z") / 1000} -in:spam -in:trash -in:drafts`,
  );
  assert.equal(f.calls.at(-1)?.name, "mail_sync_complete");
});
for (const failure of [
  "ingest",
  "identity",
  "malformed",
  "loop",
  "quota",
  "stale",
  "expired",
]) {
  test(`R06-I03 ${failure} fails without advancing the checkpoint`, async () => {
    const f = setup(null);
    let pages = 0;
    if (failure === "expired")
      f.deps.now = () => Date.parse("2026-11-08T12:16:00Z");
    const request = async <R>(path: string) => {
      if (path === "profile") return { historyId: "90071992547409939999" } as R;
      if (failure === "quota") throw new GmailError(429);
      if (failure === "malformed")
        return { messages: [{ id: "not-a-gmail-id" }] } as R;
      if (path.startsWith("messages?")) {
        pages++;
        return {
          messages: [{ id: "aa" }],
          ...(failure === "loop" ? { nextPageToken: "same" } : {}),
        } as R;
      }
      if (failure === "stale") f.invalidate();
      return { id: failure === "identity" ? "bb" : "aa" } as R;
    };
    await assert.rejects(
      syncSelectedMailbox(f.account, 7, f.deps, {
        request,
        ingest: async () => {
          if (failure === "ingest") throw Error("ingest failed");
        },
      }),
    );
    assert.equal(
      f.calls.some((c) => c.name === "mail_sync_complete"),
      false,
    );
    assert.equal(f.calls.at(-1)?.name, "mail_sync_abort");
    if (failure === "loop") assert.equal(pages, 2);
  });
}
test("R06-I03 mismatched route rejects before token/quota even inside a valid cycle", async () => {
  const f = setup();
  let token = 0,
    quota = 0;
  f.deps.rpc = async () => ({
    account_id: f.account,
    provider: "gmail_oauth",
    revision: 8,
    verification_context_hash: null,
    config_generation: 0,
    project_id: null,
    auth_config_id: null,
    quota_project_id: null,
  });
  await assert.rejects(
    withMailRuntime(f.deps, () =>
      withMailboxScope(
        { account: f.account, revision: 7, validate: async () => true },
        () =>
          executeRuntimeMail(
            { account: f.account, path: "profile", init: {} },
            {
              direct: async () => {
                token++;
                throw Error("TOKEN");
              },
              quota: async () => {
                quota++;
              },
            },
          ),
      ),
    ),
  );
  assert.equal(token, 0);
  assert.equal(quota, 0);
});
test("R06-I03 scheduling filters disabled Composio, skips reception off and never watches proxy", async () => {
  const f = setup(),
    other = randomUUID(),
    paused = randomUUID();
  const rows = [
    {
      account_id: f.account,
      provider: "gmail_oauth",
      route_revision: 2,
      receive_enabled: true,
      watch_expires_at: null,
    },
    {
      account_id: other,
      provider: "composio",
      route_revision: 4,
      receive_enabled: true,
      watch_expires_at: null,
    },
    {
      account_id: paused,
      provider: "gmail_oauth",
      route_revision: 3,
      receive_enabled: false,
      watch_expires_at: null,
    },
  ];
  f.deps.rpc = async () => rows;
  f.deps.composioEnabled = false;
  assert.equal((await selectedMailboxSchedule(f.deps)).length, 2);
  f.deps.composioEnabled = true;
  const previous = process.env.GMAIL_SYNC_MODE;
  process.env.GMAIL_SYNC_MODE = "pubsub";
  try {
    const jobs: Parameters<Parameters<typeof scheduleMailboxJobs>[1]>[0][] = [];
    await scheduleMailboxJobs(
      await selectedMailboxSchedule(f.deps),
      async (job) => {
        jobs.push(job);
      },
    );
    assert.deepEqual(
      jobs.map((j) => [j.kind, j.payload.account_id, j.payload.route_revision]),
      [
        ["gmail_sync", f.account, 2],
        ["gmail_watch", f.account, 2],
        ["gmail_sync", other, 4],
      ],
    );
  } finally {
    if (previous === undefined) delete process.env.GMAIL_SYNC_MODE;
    else process.env.GMAIL_SYNC_MODE = previous;
  }
});
test("R06-I03 old watch and changed provider do not enter the direct OAuth callback", async () => {
  const f = setup();
  let read = 0,
    effect = 0;
  f.deps.rpc = async () => {
    read++;
    return null;
  };
  await withSelectedDirectJob(f.deps, f.account, undefined, async () => {
    effect++;
  });
  assert.equal(read, 0);
  await withSelectedDirectJob(f.deps, f.account, 7, async () => {
    effect++;
  });
  assert.equal(effect, 0);
});
