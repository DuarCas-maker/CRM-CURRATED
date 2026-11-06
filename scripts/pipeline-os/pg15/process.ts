import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, realpath, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  Config,
  Engine,
  Side,
  Session,
  Identity,
  Answer,
  demand,
  hash,
  within,
  ports,
  QaError,
  validateConfig,
  validateIdentity,
  one,
  markerValue,
} from "./types";
import { identitySql } from "./fixture";

export type SpawnFn = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    shell: false;
    windowsHide: true;
    stdio: "pipe";
  },
) => ChildProcessWithoutNullStreams;
export const rowNames = new Set([
  "qa_identity",
  "qa_snapshot",
  "qa_wait",
  "qa_facts",
  "qa_schema",
  "pipeline_os_abc_preflight",
  "pipeline_os_abc_application",
  "pipeline_os_abc_postflight",
]);
export function parseOutput(output: string) {
  let heading = "";
  const rows: Record<string, unknown>[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (rowNames.has(line)) {
      heading = line;
      continue;
    }
    if (!heading || !line.startsWith("{")) continue;
    try {
      rows.push({ [heading]: JSON.parse(line) });
    } catch {
      throw new QaError("QA_BAD_PROCESS_JSON");
    }
    heading = "";
  }
  return rows;
}
export function sanitizedError(stderr: string) {
  return {
    sqlState: /ERROR:\s+([A-Z0-9]{5}):/.exec(stderr)?.[1],
    token:
      /\b(ABC_[A-Z0-9_]+|BRAND_FORBIDDEN|QA_INJECTED_FAILURE)\b/.exec(
        stderr,
      )?.[1] || "QA_SQL_FAILED",
  };
}
export function cleanEnv(
  config: Config,
  side: Side,
  inherited: Record<string, string | undefined> = process.env,
) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP"])
    if (inherited[key]) env[key] = inherited[key];
  env.PATH = path.join(config.runtimeRoot, "bin");
  env.PGPASSFILE = config[side].passfile;
  env.PGCONNECT_TIMEOUT = "3";
  env.PGAPPNAME = `abc049_${config.runId}`;
  env.PGOPTIONS = "-c statement_timeout=20000 -c lock_timeout=2000";
  return env;
}
export function psqlArgs(config: Config, side: Side, database: string) {
  demand(
    database === "postgres" ||
      new RegExp(`^abc049_${config.runId}_[a-z][a-z0-9_]{0,25}$`).test(
        database,
      ),
    "QA_BAD_DATABASE",
  );
  return [
    "-X",
    "-w",
    "-q",
    "-A",
    "--pset=footer=off",
    "--set=ON_ERROR_STOP=1",
    "--set=VERBOSITY=verbose",
    "--set=SHOW_CONTEXT=never",
    "-h",
    "127.0.0.1",
    "-p",
    String(ports[side]),
    "-U",
    "postgres",
    "-d",
    database,
  ];
}
export class PsqlChannel {
  private pending?: {
    marker: string;
    output: string;
    resolve: (answer: Answer) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private stderr = "";
  private buffer = "";
  private ended = false;
  private endCode = 1;
  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 16_000_000) return this.abort("QA_OUTPUT_LIMIT");
      let i: number;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).replace(/\r$/, "");
        this.buffer = this.buffer.slice(i + 1);
        const p = this.pending;
        if (!p) continue;
        if (line === p.marker) {
          clearTimeout(p.timer);
          this.pending = undefined;
          try {
            p.resolve({ code: 0, rows: parseOutput(p.output) });
          } catch {
            p.resolve({ code: 1, rows: [], token: "QA_BAD_PROCESS_JSON" });
          }
        } else {
          p.output += line + "\n";
          if (p.output.length > 16_000_000) this.abort("QA_OUTPUT_LIMIT");
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-16_000);
    });
    child.stdin.on("error", () => this.finish(1));
    child.on("error", () => this.abort("QA_PROCESS_START"));
    child.on("close", (code) => this.finish(code ?? 1));
  }
  private finish(code: number) {
    this.ended = true;
    this.endCode = code;
    if (this.pending) {
      const p = this.pending;
      clearTimeout(p.timer);
      this.pending = undefined;
      p.resolve({ code: code || 1, rows: [], ...sanitizedError(this.stderr) });
    }
  }
  private abort(token: string) {
    if (this.pending) {
      const p = this.pending;
      clearTimeout(p.timer);
      this.pending = undefined;
      p.resolve({ code: 1, rows: [], token });
    }
    this.child.kill();
    this.ended = true;
  }
  sql(text: string, timeoutMs = 30_000): Promise<Answer> {
    demand(!this.pending, "QA_SESSION_BUSY");
    demand(timeoutMs > 0 && timeoutMs <= 60_000, "QA_BAD_TIMEOUT");
    if (this.ended)
      return Promise.resolve({
        code: this.endCode || 1,
        rows: [],
        ...sanitizedError(this.stderr),
      });
    return new Promise((resolve) => {
      const marker = "__qa_" + randomBytes(12).toString("hex");
      this.stderr = "";
      this.pending = {
        marker,
        output: "",
        resolve,
        timer: setTimeout(() => this.abort("QA_PROCESS_TIMEOUT"), timeoutMs),
      };
      this.child.stdin.write(text + "\n\\echo " + marker + "\n");
    });
  }
  async close() {
    if (this.ended) return;
    if (this.pending) this.abort("QA_SESSION_CLOSED");
    else {
      this.child.stdin.end("\\q\n");
      this.child.kill();
      this.ended = true;
    }
  }
}
export async function nativeEngine(
  raw: unknown,
  workspace: string,
  launch: SpawnFn = spawn as SpawnFn,
): Promise<Engine> {
  const c = validateConfig(raw, workspace);
  const workspaceReal = await realpath(workspace);
  const runtime = await realpath(c.runtimeRoot);
  demand(
    within(path.join(workspaceReal, ".local/toolchains"), runtime),
    "QA_RUNTIME_REALPATH",
  );
  const binaries: Record<string, string> = {};
  for (const [name, sha] of Object.entries(c.binaries)) {
    const file = await realpath(
      path.join(
        runtime,
        "bin",
        name + (process.platform === "win32" ? ".exe" : ""),
      ),
    );
    demand(
      within(runtime, file) &&
        (await stat(file)).isFile() &&
        hash(await readFile(file)) === sha,
      "QA_BINARY_HASH",
    );
    binaries[name] = file;
  }
  for (const side of ["primary", "recovery"] as const) {
    const sideRoot = path.join(
      workspaceReal,
      ".local/pipeline-os/pg15-049",
      c.runId,
      side,
    );
    for (const p of [c[side].dataDirectory, c[side].marker, c[side].passfile])
      demand(within(sideRoot, await realpath(p)), "QA_TARGET_REALPATH");
    demand(
      (await stat(c[side].dataDirectory)).isDirectory() &&
        (await stat(c[side].marker)).isFile() &&
        (await stat(c[side].passfile)).isFile(),
      "QA_TARGET_FILE_KIND",
    );
    const m = JSON.parse(await readFile(c[side].marker, "utf8"));
    demand(
      m.protocol === "AF-PG15-CLUSTER-r1" &&
        m.runId === c.runId &&
        m.systemIdentifier === c[side].systemIdentifier &&
        path.resolve(m.dataDirectory) === path.resolve(c[side].dataDirectory),
      "QA_CLUSTER_MARKER",
    );
  }
  const args = (side: Side, database: string) => [
    "-h",
    "127.0.0.1",
    "-p",
    String(ports[side]),
    "-U",
    "postgres",
    "-w",
    "-d",
    database,
  ];
  const connect = async (side: Side, database: string): Promise<Session> => {
    const channel = new PsqlChannel(
      launch(binaries.psql, psqlArgs(c, side, database), {
        env: cleanEnv(c, side),
        shell: false,
        windowsHide: true,
        stdio: "pipe",
      }),
    );
    try {
      const identity = one(
        await channel.sql(identitySql),
        "qa_identity",
      ) as Identity;
      validateIdentity(c, side, database, identity);
      return {
        identity,
        sql: (s, timeout) => channel.sql(s, timeout),
        close: () => channel.close(),
      };
    } catch (error) {
      await channel.close();
      throw error;
    }
  };
  const runTool = (
    name: string,
    side: Side,
    toolArgs: string[],
    versionCheck = false,
  ) =>
    new Promise<void>((resolve, reject) => {
      const child = launch(binaries[name], toolArgs, {
        env: cleanEnv(c, side),
        shell: false,
        windowsHide: true,
        stdio: "pipe",
      });
      let stderr = "",
        stdout = "",
        done = false;
      const finish = (ok: boolean, timeout = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (
          ok &&
          (!versionCheck ||
            /\(PostgreSQL\) (15\.[0-9]+)(?:\s|$)/.exec(stdout)?.[1] ===
              c.runtimeVersion)
        )
          resolve();
        else
          reject(
            new QaError(
              timeout
                ? "QA_PROCESS_TIMEOUT"
                : versionCheck
                  ? "QA_BINARY_VERSION"
                  : "QA_TOOL_FAILED",
              sanitizedError(stderr).sqlState,
            ),
          );
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(false, true);
      }, 30_000);
      child.stdout.on("data", (b) => {
        if (versionCheck) stdout = (stdout + b.toString()).slice(-4096);
      }); // Never retain archive/SQL output.
      child.stderr.on("data", (b) => {
        stderr = (stderr + b.toString()).slice(-16_000);
      });
      child.on("error", () => finish(false));
      child.on("close", (code) => finish(code === 0));
      child.stdin.end();
    });
  for (const name of ["psql", "pg_dump", "pg_restore", "pg_ctl"])
    await runTool(name, "primary", ["--version"], true);
  const archiveRoot = path.join(
    workspaceReal,
    ".local/pipeline-os/pg15-049",
    c.runId,
    "archives",
  );
  const archive = (label: string) => {
    demand(/^(base|final)$/.test(label), "QA_ARCHIVE_LABEL");
    return path.join(archiveRoot, label + ".dump");
  };
  const verifyDb = async (side: Side, database: string) => {
    const s = await connect(side, database);
    await s.close();
  };
  return {
    mode: "native",
    connect,
    async backup(side, database, label) {
      psqlArgs(c, side, database);
      await verifyDb(side, database);
      await mkdir(archiveRoot, { recursive: true });
      demand(
        within(
          path.join(workspaceReal, ".local/pipeline-os/pg15-049", c.runId),
          await realpath(archiveRoot),
        ),
        "QA_ARCHIVE_PATH",
      );
      const file = archive(label);
      // Never overwrite or follow a pre-existing archive/symlink.
      try {
        await stat(file);
        throw new QaError("QA_ARCHIVE_EXISTS");
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      await runTool("pg_dump", side, [
        ...args(side, database),
        "--format=custom",
        "--file",
        file,
      ]);
      return hash(await readFile(file));
    },
    async restore(side, database, label, sha) {
      psqlArgs(c, side, database);
      await verifyDb(side, database);
      const file = archive(label);
      demand(
        within(archiveRoot, await realpath(file)) &&
          hash(await readFile(file)) === sha,
        "QA_ARCHIVE_HASH",
      );
      await runTool("pg_restore", side, [
        ...args(side, database),
        "--exit-on-error",
        file,
      ]);
    },
    async stop(side) {
      demand(c.stopOwnedClusters, "QA_STOP_NOT_APPROVED");
      await verifyDb(side, "postgres");
      await runTool("pg_ctl", side, [
        "stop",
        "-D",
        c[side].dataDirectory,
        "-m",
        "fast",
        "-w",
        "-t",
        "15",
      ]);
    },
  };
}
