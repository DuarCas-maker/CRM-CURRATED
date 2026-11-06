import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { loadBundle } from "../scripts/pipeline-os/pg15/artifacts";
import { runRehearsal } from "../scripts/pipeline-os/pg15/runner";
import {
  globalsSql,
  nativeFixture,
  snapshotSql,
  ids,
} from "../scripts/pipeline-os/pg15/fixture";
import {
  validateConfig,
  validateIdentity,
  Config,
  Bundle,
  hash,
  one,
  dbName,
  markerValue,
  executionFile,
  QaError,
} from "../scripts/pipeline-os/pg15/types";
import {
  cleanEnv,
  psqlArgs,
  parseOutput,
  sanitizedError,
  PsqlChannel,
  nativeEngine,
  SpawnFn,
} from "../scripts/pipeline-os/pg15/process";
import {
  fakeConfig,
  SimulatedEngine,
} from "./fixtures/pipeline-os-pg15-executor";

const workspace = process.cwd();
let bundlePromise: Promise<Bundle>;
const bundle = () => (bundlePromise ??= loadBundle(workspace));
const tagged = (tag: string) => (e: unknown) =>
  e instanceof QaError && e.tag === tag;

test("EX-AC01: invalid approval, unknown fields and escaped paths are rejected before any process or SQL", async () => {
  const b = await bundle(),
    c = fakeConfig(workspace);
  const variants = [
    { ...c, approvedLocalRun: false },
    { ...c, host: "crm.finlabinc.com" },
    { ...c, runtimeRoot: path.resolve(workspace, "../other") },
    {
      ...c,
      primary: {
        ...c.primary,
        dataDirectory: path.resolve(workspace, ".local/elsewhere"),
      },
    },
    {
      ...c,
      recovery: { ...c.recovery, systemIdentifier: c.primary.systemIdentifier },
    },
    { ...c, runId: "../crm" },
    { ...c, runtimeVersion: "18.3" },
  ];
  for (const input of variants) {
    const e = new SimulatedEngine(c, b.contractSha);
    await assert.rejects(runRehearsal(input, workspace, b, e), QaError);
    assert.equal(e.calls.length, 0);
  }
  let launches = 0;
  await assert.rejects(
    nativeEngine({ ...c, approvedLocalRun: false }, workspace, (() => {
      launches++;
      throw Error("never");
    }) as SpawnFn),
    tagged("QA_BAD_CONFIG"),
  );
  assert.equal(launches, 0);
  const privateRoot = path.join(
    workspace,
    ".local/pipeline-os/pg15-049",
    c.runId,
  );
  assert.equal(
    executionFile(workspace, path.join(privateRoot, "execution.json")),
    path.join(privateRoot, "execution.json"),
  );
  for (const file of [
    path.join(privateRoot, ".env"),
    path.join(privateRoot, "archives/execution.json"),
    path.join(workspace, "execution.json"),
  ])
    assert.throws(
      () => executionFile(workspace, file),
      tagged("QA_CONFIG_PATH"),
    );
});

test("EX-AC01: cluster/version/database/marker mismatch fails closed", async () => {
  const b = await bundle(),
    c = fakeConfig(workspace);
  for (const patch of [
    { version: 180003 },
    { version: 150009 },
    { listenAddresses: "*" },
    { hbaLoopbackOnly: false },
    { dataDirectory: path.resolve(workspace, ".local/production") },
    { systemIdentifier: "3333333333333333333" },
    { database: "crm" },
  ]) {
    const e = new SimulatedEngine(c, b.contractSha);
    e.identityPatch = patch;
    const r = await runRehearsal(c, workspace, b, e);
    assert.equal(r.cases[1].status, "fail");
    assert.equal(r.finished, false);
    assert.equal(
      e.calls.filter((x) => x.kind === "sql" || x.kind === "stop").length,
      0,
    );
    assert(e.closed.size > 0);
  }
  assert.throws(
    () =>
      validateIdentity(c, "primary", dbName(c, "positive"), {
        version: 150008,
        systemIdentifier: c.primary.systemIdentifier,
        dataDirectory: c.primary.dataDirectory,
        database: dbName(c, "positive"),
        marker: "another run",
        pid: 10,
        collation: "fake",
        listenAddresses: "127.0.0.1",
        serverAddress: "127.0.0.1",
        port: 55449,
        hbaLoopbackOnly: true,
      }),
    tagged("QA_IDENTITY_DATABASE"),
  );
});

test("EX-AC02: tampering the bundle or any base migration aborts without mutation/stop", async () => {
  const original = await bundle(),
    c = fakeConfig(workspace);
  for (const altered of [
    { ...original, migration: original.migration + "\nselect 1;" },
    {
      ...original,
      files: new Map(original.files).set(
        "supabase/migrations/001_core.sql",
        "select 1;",
      ),
    },
    {
      ...original,
      files: new Map(original.files).set(
        "supabase/migrations/048_forbidden.sql",
        "select 1;",
      ),
    },
  ]) {
    const e = new SimulatedEngine(c, original.contractSha),
      r = await runRehearsal(c, workspace, altered, e);
    assert.equal(r.cases[0].status, "fail");
    assert.equal(e.calls.length, 0);
  }
});

test("EX-AC04: all16 scenarios coordinate offline; simulated passes never close native/publication gates", async () => {
  const b = await bundle(),
    c = fakeConfig(workspace),
    e = new SimulatedEngine(c, b.contractSha);
  const r = await runRehearsal(c, workspace, b, e);
  assert.equal(r.finished, true, JSON.stringify(r.cases));
  assert.equal(r.cases.length, 16);
  assert(r.cases.every((x) => x.status === "pass"));
  assert.equal(r.nativeTestsExecuted, 0);
  assert.equal(r.mode, "simulated");
  assert.equal(r.publicationReady, false);
  assert.deepEqual(r.instantly, { consumed: 43, new: 0 });
  assert.equal(r.clustersStopped, true);
  assert.equal(e.calls.filter((c) => c.kind === "backup").length, 2);
  assert.equal(e.calls.filter((c) => c.kind === "restore").length, 2);
  assert.equal(e.calls.filter((c) => c.kind === "stop").length, 2);
  assert.equal(
    e.closed.size,
    e.calls.filter((c) => c.kind === "connect").length,
  );
  const sql = e.calls.flatMap((c) => (c.sql ? [c.sql] : []));
  assert(sql.some((s) => s.includes("QA_INJECTED_FAILURE")));
  assert(sql.some((s) => s.includes("pg_stat_activity")));
  assert(
    !sql.some(
      (s) =>
        s.includes("PGPASSWORD") || /\b(net\.http_|dblink_connect)\b/.test(s),
    ),
  );
  assert(
    e.calls.every(
      (call) => call.side === "primary" || call.side === "recovery",
    ),
  );
});

test("EX-AC03/04: nonzero exit, duplicate receipt and bad postflight are failures with cleanup and no retry", async () => {
  const b = await bundle(),
    c = fakeConfig(workspace);
  for (const flag of [
    "receiptExitFailure",
    "duplicateReceipt",
    "badPostflight",
  ] as const) {
    const e = new SimulatedEngine(c, b.contractSha);
    e[flag] = true;
    const r = await runRehearsal(c, workspace, b, e);
    assert.equal(r.cases[3].status, "fail");
    assert.equal(r.finished, false);
    assert.equal(e.calls.filter((x) => x.sql === b.migration).length, 1);
    assert.equal(e.calls.filter((x) => x.kind === "stop").length, 2);
    assert(r.cases.slice(4, 15).every((x) => x.status === "blocked"));
  }
});

test("EX-AC04: restoration drift and unobserved contention cannot be passed by process exit alone", async () => {
  const b = await bundle(),
    c = fakeConfig(workspace);
  for (const [flag, index] of [
    ["restoreCorruption", 12],
    ["missingWait", 10],
  ] as const) {
    const e = new SimulatedEngine(c, b.contractSha);
    e[flag] = true;
    const r = await runRehearsal(c, workspace, b, e);
    assert.equal(r.cases[index].status, "fail", JSON.stringify(r.cases));
    assert.equal(r.finished, false);
    assert.equal(
      e.closed.size,
      e.calls.filter((x) => x.kind === "connect").length,
    );
  }
});

test("EX-AC04/06: cluster shutdown is separately confirmed and never faked", async () => {
  const b = await bundle(),
    c = fakeConfig(workspace),
    e = new SimulatedEngine(c, b.contractSha);
  e.stopFailure = true;
  const r = await runRehearsal(c, workspace, b, e);
  assert.equal(r.cases[15].status, "blocked");
  assert.equal(r.finished, false);
  const e2 = new SimulatedEngine(c, b.contractSha),
    r2 = await runRehearsal(
      { ...c, stopOwnedClusters: false },
      workspace,
      b,
      e2,
    );
  assert.equal(r2.clustersStopped, false);
  assert.equal(e2.calls.filter((x) => x.kind === "stop").length, 0);
});

test("EX-AC03: psql flags/environment are explicit and never inherit DSN/provider values", () => {
  const c = fakeConfig(workspace);
  const env = cleanEnv(c, "primary", {
    PATH: "bad",
    PGHOST: "remote",
    PGPASSWORD: "synthetic",
    DATABASE_URL: "synthetic",
    COMPOSIO_API_KEY: "synthetic",
    SystemRoot: "C:/Windows",
  });
  assert.equal(env.PGHOST, undefined);
  assert.equal(env.PGPASSWORD, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.COMPOSIO_API_KEY, undefined);
  assert.equal(env.PGPASSFILE, c.primary.passfile);
  const args = psqlArgs(c, "primary", dbName(c, "base"));
  assert(
    args.includes("-X") &&
      args.includes("-w") &&
      args.includes("127.0.0.1") &&
      args.includes("55449"),
  );
  assert(!args.includes("--single-transaction") && !args.includes("-a"));
  assert.throws(
    () => psqlArgs(c, "primary", "postgresql://remote/db"),
    tagged("QA_BAD_DATABASE"),
  );
  assert.throws(
    () => psqlArgs(c, "primary", dbName(c, "base") + " extra"),
    tagged("QA_BAD_DATABASE"),
  );
});

test("EX-AC03: output parser requires known headers; errors never expose raw stderr", () => {
  assert.deepEqual(parseOutput('qa_facts\n{"ok":true}\n'), [
    { qa_facts: { ok: true } },
  ]);
  assert.deepEqual(
    parseOutput('unknown_column\n{"private":"synthetic"}\n'),
    [],
  );
  assert.throws(
    () => parseOutput("qa_facts\n{broken}\n"),
    tagged("QA_BAD_PROCESS_JSON"),
  );
  const e = sanitizedError(
    "ERROR:  P0001: ABC_BASE_CONTRACT_MISMATCH\nDETAIL: synthetic-secret\nQUERY: secret",
  );
  assert.deepEqual(e, {
    sqlState: "P0001",
    token: "ABC_BASE_CONTRACT_MISMATCH",
  });
});

function child(onWrite: (text: string, child: any) => void) {
  const c: any = new EventEmitter();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.kills = 0;
  c.stdin = new Writable({
    write(chunk, _encoding, callback) {
      onWrite(chunk.toString(), c);
      callback();
    },
  });
  c.kill = () => {
    c.kills++;
    queueMicrotask(() => c.emit("close", 1));
    return true;
  };
  return c as ChildProcessWithoutNullStreams & {
    kills: number;
    stdout: PassThrough;
    stderr: PassThrough;
  };
}
test("EX-AC03: persistent channel frames split output, bounds waits and closes only its child", async () => {
  const c = child((text, self) => {
    const marker = /\\echo (__qa_[a-f0-9]+)/.exec(text)?.[1];
    if (marker) {
      self.stdout.write('qa_facts\n{"ok":');
      self.stdout.write("true}\n" + marker + "\n");
    }
  });
  const ch = new PsqlChannel(c);
  assert.deepEqual(one(await ch.sql("select 1;"), "qa_facts"), { ok: true });
  await ch.close();
  assert.equal(c.kills, 1);
  const hanging = child(() => {}),
    channel = new PsqlChannel(hanging);
  const promise = channel.sql("select 1;", 20);
  assert.throws(() => channel.sql("select 2;"), tagged("QA_SESSION_BUSY"));
  assert.equal((await promise).token, "QA_PROCESS_TIMEOUT");
  assert.equal(hanging.kills, 1);
  await channel.close();
});

test("EX-AC01/03: verified file hashes/version and cluster identity gate a mocked native process", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "abc049-executor-"));
  try {
    const c = fakeConfig(dir);
    await mkdir(path.join(c.runtimeRoot, "bin"), { recursive: true });
    const suffix = process.platform === "win32" ? ".exe" : "";
    for (const name of ["psql", "pg_dump", "pg_restore", "pg_ctl"] as const) {
      const bytes = "nonexecutable test placeholder " + name;
      await writeFile(path.join(c.runtimeRoot, "bin", name + suffix), bytes);
      c.binaries[name] = hash(bytes);
    }
    for (const side of ["primary", "recovery"] as const) {
      await mkdir(c[side].dataDirectory, { recursive: true });
      await writeFile(c[side].passfile, "synthetic");
      await writeFile(
        c[side].marker,
        JSON.stringify({
          protocol: "AF-PG15-CLUSTER-r1",
          runId: c.runId,
          systemIdentifier: c[side].systemIdentifier,
          dataDirectory: c[side].dataDirectory,
        }),
      );
    }
    const invocations: { file: string; args: string[]; options: any }[] = [];
    let badVersion = false,
      badIdentity = false;
    const launch: SpawnFn = (file, args, options) => {
      invocations.push({ file, args, options });
      const cp = child((text, self) => {
        const marker = /\\echo (__qa_[a-f0-9]+)/.exec(text)?.[1];
        if (marker) {
          self.stdout.write(
            "qa_identity\n" +
              JSON.stringify({
                version: 150008,
                systemIdentifier: badIdentity
                  ? "wrong"
                  : c.primary.systemIdentifier,
                dataDirectory: c.primary.dataDirectory,
                database: "postgres",
                marker: null,
                pid: 55,
                collation: "synthetic",
                listenAddresses: "127.0.0.1",
                serverAddress: "127.0.0.1",
                port: 55449,
                hbaLoopbackOnly: true,
              }) +
              "\n" +
              marker +
              "\n",
          );
        }
      });
      if (args[0] === "--version")
        queueMicrotask(() => {
          cp.stdout.write(
            `tool (PostgreSQL) ${badVersion ? "18.1" : "15.8"}\n`,
          );
          cp.emit("close", 0);
        });
      return cp;
    };
    const e = await nativeEngine(c, dir, launch);
    const session = await e.connect("primary", "postgres");
    await session.close();
    assert.equal(invocations.length, 5);
    assert(
      invocations.every(
        (x) => x.options.shell === false && x.options.windowsHide === true,
      ),
    );
    badVersion = true;
    await assert.rejects(
      nativeEngine(c, dir, launch),
      tagged("QA_BINARY_VERSION"),
    );
    badVersion = false;
    badIdentity = true;
    const e2 = await nativeEngine(c, dir, launch);
    await assert.rejects(
      e2.connect("primary", "postgres"),
      tagged("QA_IDENTITY_CLUSTER"),
    );
    const before = invocations.length;
    await assert.rejects(
      nativeEngine(
        { ...c, binaries: { ...c.binaries, psql: "0".repeat(64) } },
        dir,
        launch,
      ),
      tagged("QA_BINARY_HASH"),
    );
    assert.equal(invocations.length, before);
  } finally {
    // Only this freshly created test directory; never workspace/cluster paths.
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

test("EX-AC02/05: native fixture/snapshot SQL parses in memory and exact049/postflight stay sealed", async () => {
  const b = await bundle(),
    sql = nativeFixture(b),
    db = new PGlite();
  try {
    assert.equal(sql.length, 52);
    assert(!sql.join("\n").includes("revoke maintain"));
    await db.exec(globalsSql);
    for (const part of sql) {
      // Every native fixture step has a new psql session starting as postgres.
      await db.exec("reset role");
      if (part.includes("PRM-FINAL-r1") && part.includes("begin")) {
        // Only PG18 test scaffolding: PG15 has no MAINTAIN privilege.
        for (const t of b.contract.prmTargets)
          await db.exec(
            `revoke maintain on table ${t.key} from anon,authenticated`,
          );
      }
      await db.exec(part);
    }
    const run = async (s: string, key: string) => {
      await db.exec("reset role;set role supabase_admin");
      const rows = (await db.exec(s)).flatMap((r) => r.rows);
      return rows.find((r: any) => Object.hasOwn(r, key))?.[key] as any;
    };
    const before = await run(snapshotSql(b), "qa_snapshot");
    const originalRows = await run(snapshotSql(b, before.shape), "qa_snapshot");
    const pre = await run(
      "reset role;set role supabase_admin;" + b.preflight,
      "pipeline_os_abc_preflight",
    );
    assert(pre.catalogOk, JSON.stringify(pre.mismatches));
    const a = await run(b.migration, "pipeline_os_abc_application");
    const after = await run(snapshotSql(b, before.shape), "qa_snapshot");
    assert(after.rows);
    assert.deepEqual(after.rows, originalRows.rows);
    assert(after.catalog);
    assert(a.targetsOk);
    const post = await run(b.postflight, "pipeline_os_abc_postflight");
    assert(post.targetsOk && post.rolesOk);
    assert.equal(a.protectedAfter, post.protectedFingerprint);
    assert.equal(
      (
        await db.query<{ count: number }>(
          `select count(*)::integer count from public.documents where id='${ids.document}' and access_area is null`,
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          `select count(*)::integer count from public.documents d join public.document_versions v on v.document_id=d.id where d.id='${ids.knownDocument}' and d.access_area='seller' and v.access_area='seller'`,
        )
      ).rows[0].count,
      1,
    );
    // Execute the new controller's permission probes against the synthetic SQL,
    // not just against canned process outcomes. These remain PG18, not PG15.
    const config = fakeConfig(workspace),
      simulation = new SimulatedEngine(config, b.contractSha);
    assert((await runRehearsal(config, workspace, b, simulation)).finished);
    const permissionSql = simulation.calls.filter(
      (c) =>
        c.db === dbName(config, "permissions") &&
        c.sql &&
        (c.sql.includes("request.jwt.claims") ||
          c.sql.includes("set role anon;select *")),
    );
    for (const call of permissionSql) {
      await db.exec("reset role");
      if (call.sql!.includes('"aal":"aal1"')) {
        await assert.rejects(
          db.exec(call.sql!),
          /BRAND_FORBIDDEN|MFA|permission denied/i,
        );
        await db.exec("rollback");
      } else if (
        call.sql!.includes("set role anon;select *") ||
        call.sql!.includes("composio_binding_check_finish")
      ) {
        await assert.rejects(
          db.exec(call.sql!),
          (e: any) => e.code === "42501",
        );
        await db.exec("rollback");
      } else {
        const outputs = (await db.exec(call.sql!)).flatMap((r) => r.rows);
        if (call.sql!.includes("'visible'")) {
          const expected = call.sql!.includes(ids.seller) ? 1 : 0;
          assert.equal(
            (outputs.find((r: any) => r.qa_facts)?.qa_facts as any).visible,
            expected,
          );
        }
      }
    }
  } finally {
    await db.close();
  }
});
