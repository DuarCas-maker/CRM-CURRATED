// Compare the exact public baseline against this candidate, offline and with fictitious data.
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pipelinePerformanceFixture } from "../../../tests/fixtures/pipeline-performance.ts";
import { readPipelineBoard } from "../../../src/lib/server/pipeline-os-module.ts";
import { readMasterPipeline } from "../../../src/lib/server/pipeline-master.ts";
import { readTasksOverview } from "../../../src/lib/server/pipeline-tasks.ts";
import { parseMasterQuery } from "../../../src/lib/pipeline-os/master-pipeline.ts";
import { parseTaskOverviewQuery } from "../../../src/lib/pipeline-os/tasks-overview.ts";

const baseline = "087e951aa88c56de2bb83890e531cc65b7d0a98a";
const names = ["pipeline-os-module", "pipeline-master", "pipeline-tasks"];
const virtual = Object.fromEntries(
  names.map((name) => [
    name,
    new URL(
      `../../../src/lib/server/${name}-performance-before.ts`,
      import.meta.url,
    ).href,
  ]),
);
const source = Object.fromEntries(
  names.map((name) => [
    virtual[name],
    execFileSync("git", ["show", `${baseline}:src/lib/server/${name}.ts`], {
      encoding: "utf8",
    }).replace(
      '"./pipeline-os-module"',
      JSON.stringify(virtual["pipeline-os-module"]),
    ),
  ]),
);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in source) return { url: specifier, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url in source)
      return {
        source: source[url],
        format: "module-typescript",
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const beforeBoard = (await import(virtual["pipeline-os-module"]))
  .readPipelineBoard;
const beforeMaster = (await import(virtual["pipeline-master"]))
  .readMasterPipeline;
const beforeTasks = (await import(virtual["pipeline-tasks"])).readTasksOverview;
hook.deregister();
const realNow = Date.now,
  now = Date.parse("2026-11-18T18:00:00Z");
Date.now = () => now;
const results = [];
try {
  for (const [kind, old, current] of [
    ["board", beforeBoard, readPipelineBoard],
    ["master", beforeMaster, readMasterPipeline],
    ["tasks", beforeTasks, readTasksOverview],
  ]) {
    let before, beforeCalls;
    for (const [revision, read] of [
      ["before", old],
      ["after", current],
    ]) {
      const f = pipelinePerformanceFixture({ count: 351, cap: 500, delay: 10 }),
        start = performance.now();
      const params =
        kind === "board"
          ? { group: "files" }
          : kind === "master"
            ? parseMasterQuery(new URLSearchParams("tab=tasks"))
            : parseTaskOverviewQuery(new URLSearchParams());
      const value = await read(f.client, f.profile, params);
      const calls = f.calls.map((c) => JSON.stringify(c)).sort();
      if (revision === "before") {
        before = value;
        beforeCalls = calls;
      } else {
        assert.deepEqual(value, before, `${kind} output changed`);
        assert.deepEqual(calls, beforeCalls, `${kind} read scope changed`);
      }
      results.push({
        kind,
        revision,
        elapsed_ms: Math.round(performance.now() - start),
        ...f.metrics(),
        output_sha256: createHash("sha256")
          .update(JSON.stringify(value))
          .digest("hex"),
      });
    }
  }
} finally {
  Date.now = realNow;
}
const report = { baseline, synthetic: true, rows: 351, latency_ms: 10, results };
await writeFile(new URL('./synthetic.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, results: results.map(({ byTable, ...result }) => result) }, null, 2));
