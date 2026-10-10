import test from "node:test";
import assert from "node:assert/strict";
import { gmailSyncMode } from "../src/lib/gmail-sync";
import { scheduleMailboxJobs } from "../worker/gmail-schedule";
import { renewWatch } from "../worker/gmail";
import { POST } from "../src/app/api/gmail/push/route";

async function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const now = Date.parse("2026-10-10T12:00:00Z");
const credentials = [
  { account_id: "never-watched", watch_expires_at: null },
  { account_id: "expired-watch", watch_expires_at: "2026-10-09T00:00:00Z" },
  { account_id: "expiring-watch", watch_expires_at: "2026-10-11T00:00:00Z" },
  { account_id: "fresh-watch", watch_expires_at: "2026-10-16T00:00:00Z" },
];

test("Gmail keeps existing push deployments unless polling is explicitly selected", async () => {
  await withEnvironment({ GMAIL_SYNC_MODE: undefined }, async () => {
    assert.equal(gmailSyncMode(), "pubsub");
  });
  await withEnvironment({ GMAIL_SYNC_MODE: " polling " }, async () => {
    assert.equal(gmailSyncMode(), "polling");
  });
});

test("polling schedules every connected mailbox without watch jobs and preserves retry deduplication", async () => {
  await withEnvironment({ GMAIL_SYNC_MODE: "polling" }, async () => {
    const jobs: Parameters<Parameters<typeof scheduleMailboxJobs>[1]>[0][] = [];
    await scheduleMailboxJobs(
      credentials,
      async (job) => {
        jobs.push(job);
      },
      now,
    );
    assert.equal(jobs.length, 4);
    assert.ok(jobs.every((job) => job.kind === "gmail_sync"));
    assert.deepEqual(
      jobs.map((job) => job.payload.account_id),
      credentials.map((c) => c.account_id),
    );
    const repeated: typeof jobs = [];
    await scheduleMailboxJobs(
      credentials,
      async (job) => {
        repeated.push(job);
      },
      now + 1000,
    );
    assert.deepEqual(repeated, jobs);
  });
});

test("push mode still schedules reconciliation and renews missing or expiring watches", async () => {
  await withEnvironment({ GMAIL_SYNC_MODE: "pubsub" }, async () => {
    const jobs: Parameters<Parameters<typeof scheduleMailboxJobs>[1]>[0][] = [];
    await scheduleMailboxJobs(
      credentials,
      async (job) => {
        jobs.push(job);
      },
      now,
    );
    assert.equal(jobs.filter((job) => job.kind === "gmail_sync").length, 4);
    assert.deepEqual(
      jobs
        .filter((job) => job.kind === "gmail_watch")
        .map((job) => job.payload.account_id),
      ["never-watched", "expired-watch", "expiring-watch"],
    );
  });
});

test("old watch jobs are harmless in polling even without topic, credentials or database configuration", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  await withEnvironment(
    {
      GMAIL_SYNC_MODE: "polling",
      GOOGLE_PUBSUB_TOPIC: undefined,
      GOOGLE_OAUTH_ORGANIZATIONS: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      await renewWatch("old-job-account");
      assert.equal(fetch.mock.callCount(), 0);
    },
  );
});

test("polling ignores old push callbacks without authentication, parsing, network or database writes", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  await withEnvironment(
    {
      GMAIL_SYNC_MODE: "polling",
      GOOGLE_PUBSUB_AUDIENCE: undefined,
      GOOGLE_PUBSUB_SERVICE_ACCOUNT: undefined,
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      const response = await POST(
        new Request("https://crm.example.com/api/gmail/push", {
          method: "POST",
          body: "not json",
        }),
      );
      assert.equal(response.status, 204);
      assert.equal(await response.text(), "");
      assert.equal(fetch.mock.callCount(), 0);
    },
  );
});

test("push still requires configured audience and authenticated callbacks", async () => {
  await withEnvironment(
    {
      GMAIL_SYNC_MODE: "pubsub",
      GOOGLE_PUBSUB_AUDIENCE: undefined,
      GOOGLE_PUBSUB_SERVICE_ACCOUNT: undefined,
    },
    async () => {
      assert.equal(
        (
          await POST(
            new Request("https://crm.example.com/api/gmail/push", {
              method: "POST",
            }),
          )
        ).status,
        503,
      );
    },
  );
  await withEnvironment(
    {
      GMAIL_SYNC_MODE: "pubsub",
      GOOGLE_PUBSUB_AUDIENCE: "https://crm.example.com/api/gmail/push",
      GOOGLE_PUBSUB_SERVICE_ACCOUNT:
        "gmail-push@example.iam.gserviceaccount.com",
    },
    async () => {
      assert.equal(
        (
          await POST(
            new Request("https://crm.example.com/api/gmail/push", {
              method: "POST",
            }),
          )
        ).status,
        401,
      );
    },
  );
});

test("a misspelled sync mode fails before scheduling jobs or calling Gmail", async () => {
  await withEnvironment({ GMAIL_SYNC_MODE: "poling" }, async () => {
    let enqueued = false;
    await assert.rejects(
      scheduleMailboxJobs(
        credentials,
        async () => {
          enqueued = true;
        },
        now,
      ),
      /INVALID_GMAIL_SYNC_MODE/,
    );
    assert.equal(enqueued, false);
    await assert.rejects(
      renewWatch("old-job-account"),
      /INVALID_GMAIL_SYNC_MODE/,
    );
  });
});
