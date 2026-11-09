import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  withWorkerPilot,
  authorizeWorkerRequest,
  pilotAccessToken,
  inWorkerPilot,
  type WorkerPilotContext,
} from "../src/lib/server/worker-request-control";
import { startWorkerPilot, workerExecutionMode } from "../worker/pilot-runtime";

const accountId = randomUUID(),
  outboxId = randomUUID();
const context = (
  extra: Partial<WorkerPilotContext> = {},
): WorkerPilotContext => ({
  accountId,
  outboxId,
  provider: "gmail_oauth",
  action: "send",
  threadId: null,
  authorize: async () => true,
  ...extra,
});
test("worker modes reject unknown/empty settings instead of falling into normal", () => {
  assert.equal(workerExecutionMode(undefined), "normal");
  assert.equal(workerExecutionMode("paused"), "paused");
  assert.equal(workerExecutionMode("pilot"), "pilot");
  for (const mode of ["", "PILOT", "false", " pilot"])
    assert.throws(() => workerExecutionMode(mode));
});
test("pilot excludes other accounts, providers and resources before authorization or OAuth", async () => {
  let checks = 0;
  await withWorkerPilot(
    context({
      authorize: async () => {
        checks++;
        return true;
      },
    }),
    async () => {
      for (const [provider, account, path, method] of [
        ["gmail_oauth", randomUUID(), "messages/send", "POST"],
        ["composio", accountId, "messages/send", "POST"],
        ["gmail_oauth", accountId, "watch", "POST"],
        ["gmail_oauth", accountId, "messages?q=all", "GET"],
        ["gmail_oauth", accountId, "history", "GET"],
        ["gmail_oauth", accountId, "threads/abc?format=full", "GET"],
      ] as const)
        await assert.rejects(
          authorizeWorkerRequest(provider, account, path, method),
          /WORKER_PILOT_HELD/,
        );
    },
  );
  assert.equal(checks, 0);
  assert.equal(inWorkerPilot(), false);
});
test("lease denial prevents expired-token refresh and all wire calls", async () => {
  let wires = 0;
  await withWorkerPilot(context({ authorize: async () => false }), async () => {
    await assert.rejects(
      pilotAccessToken(
        accountId,
        { refresh_token: "fictional" },
        { clientId: "fictional", clientSecret: "fictional" },
        async () => {
          wires++;
          return Response.json({});
        },
      ),
      /WORKER_PILOT_HELD/,
    );
  });
  assert.equal(wires, 0);
});
test("OAuth reserves actual failed attempts once, never retries, and reuses a valid token", async () => {
  const reservations: string[] = [];
  let wires = 0;
  await withWorkerPilot(
    context({
      authorize: async (request, reserve) => {
        if (reserve) reservations.push(request.kind);
        return true;
      },
    }),
    async () => {
      const org = { clientId: "fixture", clientSecret: "fixture" };
      const fetchImpl: typeof fetch = async (input, init) => {
        wires++;
        assert.equal(String(input), "https://oauth2.googleapis.com/token");
        assert.equal(init?.redirect, "manual");
        return Response.json({}, { status: 503 });
      };
      await assert.rejects(
        pilotAccessToken(
          accountId,
          { refresh_token: "fixture" },
          org,
          fetchImpl,
        ),
      );
      assert.equal(wires, 1);
      const token = await pilotAccessToken(
        accountId,
        { access_token: "still-valid", expiry_date: 200000 },
        org,
        fetchImpl,
        0,
      );
      assert.equal(token.token, "still-valid");
    },
  );
  assert.deepEqual(reservations, ["oauth"]);
});
test("thread operation is exact and async contexts cannot leak between simultaneous runs", async () => {
  const seen: string[] = [];
  await Promise.all(
    ["abc123", "def456"].map((threadId) =>
      withWorkerPilot(
        context({
          action: "thread",
          threadId,
          authorize: async (r) => {
            await Promise.resolve();
            seen.push(r.target);
            return true;
          },
        }),
        async () => {
          await authorizeWorkerRequest(
            "gmail_oauth",
            accountId,
            `threads/${threadId}?format=full`,
          );
          await assert.rejects(
            authorizeWorkerRequest(
              "gmail_oauth",
              accountId,
              `threads/${threadId}?format=metadata`,
            ),
          );
          await assert.rejects(
            authorizeWorkerRequest(
              "gmail_oauth",
              accountId,
              "messages/send",
              "POST",
            ),
          );
        },
      ),
    ),
  );
  assert.deepEqual(seen.sort(), ["abc123", "def456"]);
  assert.equal(inWorkerPilot(), false);
});
test("runtime only sends selected claim then reads persisted thread; no global work on close", async () => {
  let status = "queued",
    claimed = false,
    closed = false,
    wire = 0;
  const rpcCalls: string[] = [];
  const pilotId = randomUUID(),
    lease = "a".repeat(64);
  const runtime = await startWorkerPilot(
    pilotId,
    {
      rpc: async (name, p) => {
        rpcCalls.push(name);
        assert.equal(p.pilot, pilotId);
        assert.equal(p.lease, lease);
        if (name === "worker_pilot_acquire") return true;
        if (name === "worker_pilot_snapshot")
          return closed
            ? null
            : {
                accountId,
                outboxId,
                provider: "gmail_oauth",
                claimed,
                status,
                threadId: status === "sent" ? "abc123" : null,
              };
        if (name === "worker_pilot_request") return !closed;
        throw Error("Unexpected RPC");
      },
      send: async (claim) => {
        assert.equal(claim.pilotId, pilotId);
        await authorizeWorkerRequest(
          "gmail_oauth",
          accountId,
          "messages/send",
          "POST",
          true,
        );
        wire++;
        claimed = true;
        status = "sent";
      },
      readThread: async (a, thread) => {
        assert.equal(a, accountId);
        assert.equal(thread, "abc123");
        await authorizeWorkerRequest(
          "gmail_oauth",
          a,
          `threads/${thread}?format=full`,
          "GET",
          true,
        );
        wire++;
      },
    },
    lease,
  );
  assert.equal(await runtime.cycle(), "waiting");
  assert.equal(await runtime.cycle(), "observing");
  closed = true;
  assert.equal(await runtime.cycle(), "closed");
  assert.equal(await runtime.cycle(), "closed");
  assert.equal(wire, 2);
  assert(!rpcCalls.includes("claim_job"));
  assert(!rpcCalls.includes("claim_outbox"));
});
test("second acquisition fails and runtime errors permanently close local execution", async () => {
  let closes = 0,
    sends = 0;
  await assert.rejects(
    startWorkerPilot(randomUUID(), {
      rpc: async () => false,
      send: async () => {
        sends++;
      },
      readThread: async () => {},
    }),
    /WORKER_PILOT_HELD/,
  );
  const runtime = await startWorkerPilot(randomUUID(), {
    rpc: async (name) => {
      if (name === "worker_pilot_acquire") return true;
      if (name === "worker_pilot_close") {
        closes++;
        return null;
      }
      throw Error("DB unavailable");
    },
    send: async () => {
      sends++;
    },
    readThread: async () => {},
  });
  await assert.rejects(runtime.cycle(), /WORKER_PILOT_HELD/);
  assert.equal(await runtime.cycle(), "closed");
  assert.equal(closes, 1);
  assert.equal(sends, 0);
});
test("stop during an operation prevents later requests, including OAuth after a wait", async () => {
  let stopping = false,
    reservations = 0,
    wires = 0;
  const runtime = await startWorkerPilot(randomUUID(), {
    stopRequested: () => stopping,
    rpc: async (name) => {
      if (name === "worker_pilot_acquire") return true;
      if (name === "worker_pilot_snapshot")
        return {
          accountId,
          outboxId,
          provider: "gmail_oauth",
          claimed: false,
          status: "queued",
          threadId: null,
        };
      if (name === "worker_pilot_request") {
        reservations++;
        return true;
      }
      if (name === "worker_pilot_close") return null;
      throw Error("Unexpected RPC");
    },
    send: async () => {
      stopping = true;
      await assert.rejects(
        pilotAccessToken(
          accountId,
          { refresh_token: "fixture" },
          { clientId: "fixture", clientSecret: "fixture" },
          async () => {
            wires++;
            return Response.json({});
          },
        ),
      );
      await assert.rejects(
        authorizeWorkerRequest(
          "gmail_oauth",
          accountId,
          "messages/send",
          "POST",
          true,
        ),
      );
    },
    readThread: async () => {
      throw Error("Unexpected read");
    },
  });
  await runtime.cycle();
  assert.equal(await runtime.cycle(), "closed");
  assert.equal(reservations, 0);
  assert.equal(wires, 0);
});
test("entry branches precede producers and pilot sender never falls back to broad claims", async () => {
  const source = await readFile("worker/index.ts", "utf8");
  const branch = source.indexOf(
    'if (executionMode === "paused")',
    source.indexOf("while (!stopping)"),
  );
  assert(branch > 0);
  assert(branch < source.indexOf("await schedule();"));
  assert(
    source.indexOf("if (pilot)", branch) <
      source.indexOf("await scheduleCampaigns();"),
  );
  assert.match(
    source.slice(branch, source.indexOf("await schedule();")),
    /if \(pilot\)[\s\S]*continue;/,
  );
});
test("stop arriving while durable admission is pending is rechecked before returning a permit", async () => {
  let stopping = false,
    deniedObserved = 0;
  const runtime = await startWorkerPilot(randomUUID(), {
    stopRequested: () => stopping,
    rpc: async (name) => {
      if (name === "worker_pilot_acquire") return true;
      if (name === "worker_pilot_snapshot")
        return {
          accountId,
          outboxId,
          provider: "gmail_oauth",
          claimed: false,
          status: "queued",
          threadId: null,
        };
      if (name === "worker_pilot_request") {
        await Promise.resolve();
        stopping = true;
        return true;
      }
      if (name === "worker_pilot_close") return null;
      throw Error("Unexpected RPC");
    },
    send: async () => {
      await assert.rejects(
        authorizeWorkerRequest(
          "gmail_oauth",
          accountId,
          "messages/send",
          "POST",
          true,
        ),
      );
      deniedObserved++;
    },
    readThread: async () => {
      throw Error("Unexpected thread");
    },
  });
  await runtime.cycle();
  assert.equal(deniedObserved, 1);
  assert.equal(await runtime.cycle(), "closed");
});
test("paused production entry writes heartbeat with missing DB configuration and no producer execution", async () => {
  const root = resolve(".local/worker-pilot-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "entry-"));
  const heartbeat = join(directory, "heartbeat");
  const entry = join(directory, "worker.mjs");
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))(
    "esbuild",
  );
  await build({
    entryPoints: ["worker/index.ts"],
    outfile: entry,
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [
      {
        name: "resolve-next-header-fixture",
        setup(b: {
          onResolve: (
            filter: { filter: RegExp },
            callback: () => { path: string; external: boolean },
          ) => void;
        }) {
          b.onResolve({ filter: /^next\/headers$/ }, () => ({
            path: pathToFileURL(require.resolve("next/headers")).href,
            external: true,
          }));
        },
      },
    ],
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: "",
    WORKER_EXECUTION_MODE: "paused",
    WORKER_HEARTBEAT_FILE: heartbeat,
    NEXT_PUBLIC_SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    GMAIL_SYNC_MODE: "polling",
  };
  delete env.NODE_TEST_CONTEXT;
  const imports = process.execArgv.flatMap((arg, i) =>
    arg === "--import" && process.execArgv[i + 1]?.endsWith("offline.mjs")
      ? [arg, pathToFileURL(resolve(process.execArgv[i + 1])).href]
      : [],
  );
  let output = "",
    stderr = "";
  const child = spawn(process.execPath, [...imports, entry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const done = new Promise<void>((res) => child.once("close", () => res()));
  try {
    let found = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null)
        throw Error("Paused worker exited: " + stderr);
      try {
        assert(Number.isFinite(Date.parse(await readFile(heartbeat, "utf8"))));
        found = true;
        break;
      } catch {
        await new Promise((res) => setTimeout(res, 100));
      }
    }
    assert(found, "paused entry did not produce a heartbeat: " + stderr);
    assert.match(output, /Execution mode: paused/);
    assert.doesNotMatch(
      output + stderr,
      /MISSING_SUPABASE|SCHEDULER_FAILED|SENDER_FAILED|WORKER_CYCLE_FAILED|OFFLINE_NETWORK_DENIED/,
    );
  } finally {
    child.kill("SIGTERM");
    await done;
    try {
      await unlink(heartbeat);
    } catch {
      /* may fail before first heartbeat */
    }
    await unlink(entry);
    await rmdir(directory);
  }
});
