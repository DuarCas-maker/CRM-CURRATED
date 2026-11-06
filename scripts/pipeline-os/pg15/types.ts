import { z } from "zod";
import path from "node:path";
import { createHash } from "node:crypto";

export class QaError extends Error {
  constructor(
    public readonly tag: string,
    public readonly sqlState?: string,
  ) {
    super(tag);
  }
}
export function demand(value: unknown, tag: string): asserts value {
  if (!value) throw new QaError(tag);
}
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const literal = (value: string) =>
  "'" + value.replaceAll("'", "''") + "'";
export const identifier = (value: string) =>
  '"' + value.replaceAll('"', '""') + '"';
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const targetSchema = z
  .object({
    systemIdentifier: z.string().regex(/^[1-9][0-9]{9,24}$/),
    dataDirectory: z.string().min(1),
    passfile: z.string().min(1),
    marker: z.string().min(1),
  })
  .strict();
export const configSchema = z
  .object({
    protocol: z.literal("PG-EXEC-r1"),
    runId: z.string().regex(/^[a-f0-9]{24}$/),
    approvedLocalRun: z.literal(true),
    stopOwnedClusters: z.boolean(),
    runtimeRoot: z.string().min(1),
    runtimeVersion: z.string().regex(/^15\.[0-9]+$/),
    binaries: z
      .object({
        psql: digest,
        pg_dump: digest,
        pg_restore: digest,
        pg_ctl: digest,
      })
      .strict(),
    primary: targetSchema,
    recovery: targetSchema,
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export type Side = "primary" | "recovery";
export const ports = { primary: 55449, recovery: 55450 } as const;
export const markerValue = (c: Config) => `AF-PG15:${c.runId}`;
export const dbName = (c: Config, suffix: string) => {
  demand(/^[a-z][a-z0-9_]{0,25}$/.test(suffix), "QA_BAD_DATABASE");
  return `abc049_${c.runId}_${suffix}`;
};
export function within(root: string, candidate: string) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    rel !== "" &&
    !path.isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith(".." + path.sep)
  );
}
export function executionFile(workspace: string, candidate: string) {
  const root = path.resolve(workspace, ".local/pipeline-os/pg15-049");
  const file = path.resolve(candidate),
    parent = path.dirname(file);
  demand(
    within(root, file) &&
      path.basename(file) === "execution.json" &&
      /^[a-f0-9]{24}$/.test(path.basename(parent)) &&
      path.dirname(parent) === root,
    "QA_CONFIG_PATH",
  );
  return file;
}
export function validateConfig(raw: unknown, workspace: string): Config {
  const parsed = configSchema.safeParse(raw);
  demand(parsed.success, "QA_BAD_CONFIG");
  const c = parsed.data;
  demand(
    path.isAbsolute(c.runtimeRoot) &&
      within(path.join(workspace, ".local/toolchains"), c.runtimeRoot),
    "QA_RUNTIME_PATH",
  );
  const root = path.join(workspace, ".local/pipeline-os/pg15-049", c.runId);
  for (const side of ["primary", "recovery"] as const) {
    const t = c[side];
    for (const p of [t.dataDirectory, t.marker, t.passfile])
      demand(
        path.isAbsolute(p) && within(path.join(root, side), p),
        "QA_TARGET_PATH",
      );
    demand(
      new Set(
        [t.dataDirectory, t.marker, t.passfile].map((p) => path.resolve(p)),
      ).size === 3,
      "QA_TARGET_PATH",
    );
  }
  demand(
    c.primary.systemIdentifier !== c.recovery.systemIdentifier,
    "QA_SHARED_CLUSTER",
  );
  return c;
}
export type Identity = {
  version: number;
  systemIdentifier: string;
  dataDirectory: string;
  database: string;
  marker: string | null;
  pid: number;
  collation: string;
  listenAddresses: string;
  serverAddress: string;
  port: number;
  hbaLoopbackOnly: boolean;
  serverBuild?: string;
  timezone?: string;
  lcCtype?: string;
};
export function validateIdentity(
  c: Config,
  side: Side,
  database: string,
  i: Identity,
) {
  demand(
    i.version >= 150000 &&
      i.version <= 159999 &&
      i.version === 150000 + Number(c.runtimeVersion.split(".")[1]) &&
      Number.isInteger(i.pid) &&
      i.pid > 0,
    "QA_IDENTITY_VERSION",
  );
  demand(
    i.systemIdentifier === c[side].systemIdentifier &&
      path.resolve(i.dataDirectory) === path.resolve(c[side].dataDirectory),
    "QA_IDENTITY_CLUSTER",
  );
  demand(
    i.listenAddresses === "127.0.0.1" &&
      i.serverAddress === "127.0.0.1" &&
      i.port === ports[side] &&
      i.hbaLoopbackOnly === true,
    "QA_NETWORK_BOUNDARY",
  );
  demand(
    i.database === database &&
      (database === "postgres" ||
        (database.startsWith(`abc049_${c.runId}_`) &&
          i.marker === markerValue(c))),
    "QA_IDENTITY_DATABASE",
  );
}
export type Answer = {
  code: number;
  rows: Record<string, unknown>[];
  sqlState?: string;
  token?: string;
};
export interface Session {
  readonly identity: Identity;
  sql(text: string, timeoutMs?: number): Promise<Answer>;
  close(): Promise<void>;
}
export interface Engine {
  readonly mode: "simulated" | "native";
  connect(side: Side, database: string): Promise<Session>;
  backup(side: Side, database: string, label: string): Promise<string>;
  restore(
    side: Side,
    database: string,
    label: string,
    sha: string,
  ): Promise<void>;
  stop(side: Side): Promise<void>;
}
export type Files = Map<string, string>;
export type Bundle = {
  files: Files;
  migration: string;
  postflight: string;
  preflight: string;
  contract: any;
  contractSha: string;
  migrationSha: string;
  inputHashes: Record<string, string>;
};
export type CaseResult = {
  id: string;
  status: "pass" | "fail" | "blocked";
  code?: string;
  observations?: Record<string, unknown>;
};
export type Report = {
  protocol: "PG-EXEC-r1";
  mode: Engine["mode"];
  cases: CaseResult[];
  nativeTestsExecuted: number;
  publicationReady: false;
  finished: boolean;
  instantly: { consumed: 43; new: 0 };
  clustersStopped: boolean;
};
export function success(answer: Answer) {
  demand(answer.code === 0, answer.token || "QA_SQL_FAILED");
  return answer.rows;
}
export function one(answer: Answer, key: string): any {
  const rows = success(answer).filter((r) => Object.hasOwn(r, key));
  demand(rows.length === 1, "QA_MISSING_OR_DUPLICATE_RECEIPT");
  return rows[0][key];
}
