import path from "node:path";
import { pins } from "../../scripts/pipeline-os/pg15/artifacts";
import {
  Config,
  Engine,
  Side,
  Session,
  Answer,
  Identity,
  markerValue,
  ports,
} from "../../scripts/pipeline-os/pg15/types";
export function fakeConfig(workspace: string): Config {
  const runId = "abcdef012345abcdef012345";
  const root = path.join(workspace, ".local/pipeline-os/pg15-049", runId);
  const target = (side: Side, id: string) => ({
    systemIdentifier: id,
    dataDirectory: path.join(root, side, "data"),
    marker: path.join(root, side, "cluster.json"),
    passfile: path.join(root, side, "pgpass"),
  });
  return {
    protocol: "PG-EXEC-r1",
    runId,
    approvedLocalRun: true,
    stopOwnedClusters: true,
    runtimeVersion: "15.8",
    runtimeRoot: path.join(workspace, ".local/toolchains/qa-pg15"),
    binaries: {
      psql: "a".repeat(64),
      pg_dump: "b".repeat(64),
      pg_restore: "c".repeat(64),
      pg_ctl: "d".repeat(64),
    },
    primary: target("primary", "1111111111111111111"),
    recovery: target("recovery", "2222222222222222222"),
  };
}
type State = {
  installed: boolean;
  drift: boolean;
  sending: boolean;
  queued: boolean;
  uncertain: boolean;
  visible: number;
  globals: boolean;
};
export class SimulatedEngine implements Engine {
  readonly mode = "simulated" as const;
  readonly calls: { kind: string; side: Side; db?: string; sql?: string }[] =
    [];
  readonly states = new Map<string, State>();
  readonly closed = new Set<number>();
  readonly backups = new Map<string, State>();
  identityPatch: Partial<Identity> = {};
  badPostflight = false;
  receiptExitFailure = false;
  duplicateReceipt = false;
  stopFailure = false;
  missingWait = false;
  restoreCorruption = false;
  private globals = { primary: false, recovery: false };
  private pid = 100;
  private locks = new Set<string>();
  private pending = new Map<
    string,
    { resolve: (a: Answer) => void; db: string }
  >();
  constructor(
    readonly config: Config,
    readonly contractSha: string,
  ) {}
  private key(side: Side, db: string) {
    return side + ":" + db;
  }
  private state(side: Side, db: string) {
    const key = this.key(side, db);
    let s = this.states.get(key);
    if (!s) {
      s = {
        installed: false,
        drift: false,
        sending: false,
        queued: false,
        uncertain: false,
        visible: 0,
        globals: false,
      };
      this.states.set(key, s);
    }
    return s;
  }
  async connect(side: Side, database: string): Promise<Session> {
    const pid = ++this.pid;
    this.calls.push({ kind: "connect", side, db: database });
    const identity: Identity = {
      version: 150008,
      systemIdentifier: this.config[side].systemIdentifier,
      dataDirectory: this.config[side].dataDirectory,
      database,
      marker: database === "postgres" ? null : markerValue(this.config),
      pid,
      collation: "test-only",
      listenAddresses: "127.0.0.1",
      serverAddress: "127.0.0.1",
      port: ports[side],
      hbaLoopbackOnly: true,
      ...this.identityPatch,
    };
    return {
      identity,
      sql: (s) => this.execute(side, database, pid, s),
      close: async () => {
        this.closed.add(pid);
        const p = this.pending.get(this.key(side, database));
        if (p) {
          p.resolve({ code: 1, rows: [], token: "QA_SESSION_CLOSED" });
          this.pending.delete(this.key(side, database));
        }
      },
    };
  }
  private async execute(
    side: Side,
    db: string,
    pid: number,
    sql: string,
  ): Promise<Answer> {
    this.calls.push({ kind: "sql", side, db, sql });
    const s = this.state(side, db),
      key = this.key(side, db);
    const json = (key: string, value: unknown): Answer => ({
      code: 0,
      rows: [{ [key]: value }],
    });
    const error = (token: string, sqlState = "P0001"): Answer => ({
      code: 3,
      rows: [],
      token,
      sqlState,
    });
    if (sql.includes("'fresh'"))
      return json("qa_facts", { fresh: !this.globals[side] });
    if (sql.includes("create role anon")) {
      this.globals[side] = true;
      return { code: 0, rows: [] };
    }
    if (sql.startsWith("create database")) {
      const name = /create database "([a-z0-9_]+)"/.exec(sql)![1];
      const template = /template "([a-z0-9_]+)"/.exec(sql)?.[1];
      this.states.set(
        this.key(side, name),
        template
          ? structuredClone(this.state(side, template))
          : structuredClone(this.state(side, "empty")),
      );
      return { code: 0, rows: [] };
    }
    if (sql.includes("qa_snapshot"))
      return json("qa_snapshot", {
        catalog: { installed: s.installed, drift: s.drift },
        globals: "qa-roles",
        shape: { documents: ["id"] },
        rows: sql.includes("rows_digest")
          ? {
              documents: "unchanged",
              outbox: JSON.stringify([s.sending, s.queued, s.uncertain]),
            }
          : null,
      });
    if (
      sql.includes("PG15_DDL_and_final_views") ||
      sql.includes("AF-PRE-r1: proposed")
    )
      return json("pipeline_os_abc_preflight", {
        complete: true,
        catalogOk: true,
        preconditionsOk: true,
        mismatchCount: 0,
        contractSha256: this.contractSha,
        migrationSha256: pins.migration,
      });
    if (
      sql.includes("begin;lock table") ||
      sql.includes("begin;select id from public.mail_accounts")
    ) {
      this.locks.add(key);
      return { code: 0, rows: [] };
    }
    if (sql.includes("qa_wait")) {
      const waiting = this.pending.has(key) && !this.missingWait;
      if (waiting)
        setTimeout(() => {
          const p = this.pending.get(key);
          if (p) {
            this.pending.delete(key);
            p.resolve(error("QA_SQL_FAILED", "55P03"));
          }
        }, 0);
      return json("qa_wait", {
        waiting,
        locks: [{ mode: "AccessExclusiveLock", granted: false }],
      });
    }
    if (sql.trim() === "rollback;") {
      this.locks.delete(key);
      const p = this.pending.get(key);
      if (p) {
        this.pending.delete(key);
        s.installed = true;
        p.resolve(this.receipt());
      }
      return { code: 0, rows: [] };
    }
    if (sql.includes("ABC-FINAL-r1 proposed migration049")) {
      if (this.locks.has(key))
        return new Promise((resolve) => this.pending.set(key, { resolve, db }));
      if (s.sending) return error("ABC_INFLIGHT_DRAIN_REQUIRED");
      if (s.installed) return error("ABC_ALREADY_OR_PARTIALLY_INSTALLED");
      if (s.drift) return error("ABC_BASE_CONTRACT_MISMATCH");
      if (sql.includes("raise exception 'QA_INJECTED_FAILURE'"))
        return error("QA_INJECTED_FAILURE");
      if (this.receiptExitFailure) return { ...this.receipt(), code: 3 };
      s.installed = true;
      return this.receipt();
    }
    if (sql.includes("pipeline_os_abc_postflight"))
      return json("pipeline_os_abc_postflight", {
        protocol: "ABC-FINAL-r1",
        ordinal: "049",
        contractSha256: this.contractSha,
        targetsOk: !this.badPostflight,
        rolesOk: true,
        context: {
          readOnly: "on",
          sqlRole: "supabase_admin",
          searchPath: "pg_catalog, pg_temp",
          version: "150008",
        },
        gmailProviderExpected: "gmail_oauth",
        composioEnabledExpected: false,
        protectedFingerprint: "a".repeat(32),
      });
    if (sql.includes("seed-never")) throw Error("not used");
    if (
      /^reset role;set role supabase_admin;\s*insert into public.outbox/.test(
        sql,
      )
    ) {
      if (sql.includes("'sending'")) s.sending = true;
      if (sql.includes("'queued'")) s.queued = true;
      if (sql.includes("'uncertain'")) s.uncertain = true;
    }
    if (sql.includes('"aal":"aal1"')) return error("BRAND_FORBIDDEN");
    if (sql.includes("'visible'"))
      return json("qa_facts", {
        visible: sql.includes('"sub":"10000000-0000-4000-8000-000000000002"')
          ? 1
          : 0,
      });
    if (
      sql.includes("set role anon;select *") ||
      sql.includes("composio_binding_check_finish")
    )
      return error("QA_SQL_FAILED", "42501");
    if (sql.includes("'unassigned'"))
      return json("qa_facts", {
        unassigned: true,
        derived: true,
        brands: 0,
        bindings: 0,
        admissions: 0,
      });
    if (sql.includes("'oldClaim'"))
      return json("qa_facts", { oldClaim: true, newReady: false });
    if (sql.includes("'claimed'"))
      return json("qa_facts", { claimed: 0, newReady: true });
    if (
      sql.includes("create schema brand_b1;") ||
      sql.includes("set search_path=public;") ||
      sql.includes("grant select on public.mail_accounts to anon;") ||
      sql.includes("'qa-drift'") ||
      sql.includes("alter policy document_versions_read")
    )
      s.drift = true;
    return { code: 0, rows: [] };
  }
  private receipt(): Answer {
    const receipt = {
      pipeline_os_abc_application: {
        protocol: "ABC-FINAL-r1",
        ordinal: "049",
        stage: "checked_before_commit",
        contractSha256: this.contractSha,
        targetsOk: true,
        preservationMatches: true,
        gmailProviderExpected: "gmail_oauth",
        composioEnabledExpected: false,
        protectedBefore: "a".repeat(32),
        protectedAfter: "a".repeat(32),
      },
    };
    return {
      code: 0,
      rows: this.duplicateReceipt ? [receipt, receipt] : [receipt],
    };
  }
  async backup(side: Side, db: string, label: string) {
    this.calls.push({ kind: "backup", side, db });
    this.backups.set(label, structuredClone(this.state(side, db)));
    return "a".repeat(64);
  }
  async restore(side: Side, db: string, label: string) {
    this.calls.push({ kind: "restore", side, db });
    const s = structuredClone(this.backups.get(label)!);
    if (this.restoreCorruption) s.drift = true;
    this.states.set(this.key(side, db), s);
  }
  async stop(side: Side) {
    this.calls.push({ kind: "stop", side });
    if (this.stopFailure) throw Error("Synthetic failure; do not forward this");
  }
}
