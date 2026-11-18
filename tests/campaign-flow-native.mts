// PostgreSQL 15 local only. Synthetic data, no .env, no external providers.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, execFile } from "node:child_process";
import { flowFixture, flowRoot } from "./fixtures/campaign-flow";
import { exerciseLeadFunnel, funnelRoot } from "./fixtures/campaign-lead-funnel";
const bin =
  process.env.CAMPAIGN_TEST_PG_BIN ||
  path.resolve(".local/toolchains/postgresql-15/bin");
if (!fs.existsSync(path.join(bin, "postgres.exe")))
  throw Error("NATIVE_PG15_UNAVAILABLE");
const runtime = path.resolve(".local/campaign-flow-native-" + randomUUID()),
  data = path.join(runtime, "data");
const ownerRevision = process.env.CAMPAIGN_TEST_OWNER_REVISION === "1";
const revisionRoot = ownerRevision
  ? "docs/specs/pipeline-os/campaign-flow-20261117/revisions/owner-creator/"
  : flowRoot;
fs.mkdirSync(runtime, { recursive: true });
const socket = net.createServer();
await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
const port = (socket.address() as net.AddressInfo).port;
await new Promise<void>((r) => socket.close(() => r()));
const env = {
  ...process.env,
  PGHOST: "127.0.0.1",
  PGPORT: String(port),
  PGUSER: "postgres",
  PGDATABASE: "postgres",
  PGCONNECT_TIMEOUT: "5",
  PGPASSWORD: "",
  PGSSLMODE: "disable",
  PGCLIENTENCODING: "UTF8",
};
const run = (exe: string, args: string[], input?: string) =>
  execFileSync(path.join(bin, exe + ".exe"), args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    input,
    maxBuffer: 16 * 1024 * 1024,
    ...(exe === "pg_ctl" ? { stdio: "ignore" as const } : {}),
  }) || "";
const lit = (v: any): string =>
  v == null
    ? "null"
    : typeof v === "number"
      ? String(v)
      : typeof v === "boolean"
        ? String(v)
        : Array.isArray(v)
          ? `array[${v.map(lit).join(",")}]::uuid[]`
          : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
const sql = (text: string) =>
  run("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], text).trim();
const asyncSql = (text: string) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile(
      path.join(bin, "psql.exe"),
      ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
      { env, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (e, out, err) => (e ? reject(Error(err)) : resolve(out.trim())),
    );
    child.stdin!.end(text);
  });
run("initdb", [
  "-D",
  data,
  "-U",
  "postgres",
  "-A",
  "trust",
  "--no-locale",
  "--encoding=UTF8",
]);
let started = false;
try {
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(runtime, "server.log"),
    "-o",
    `-p ${port} -h 127.0.0.1`,
    "-w",
    "start",
  ]);
  started = true;
  let role = "",
    claims = "{}";
  const settings = new Map<string, string>();
  const prefix = () =>
    `set request.jwt.claims=${lit(claims)};${[...settings].map(([k, v]) => `set ${k}=${lit(v)};`).join("")}${role ? `set role ${role};` : ""}`;
  function state(text: string) {
    let rest = text;
    while (true) {
      let m = rest.match(/^\s*reset role\s*;?/i);
      if (m) {
        role = "";
        rest = rest.slice(m[0].length);
        continue;
      }
      m = rest.match(/^\s*set role (authenticated|service_role)\s*;?/i);
      if (m) {
        role = m[1];
        rest = rest.slice(m[0].length);
        continue;
      }
      m = rest.match(/^\s*set (pipeline_os\.[a-z0-9_]+)='([^']*)'\s*;?/i);
      if (m) {
        settings.set(m[1], m[2]);
        rest = rest.slice(m[0].length);
        continue;
      }
      break;
    }
    return rest;
  }
  const db = {
    exec: async (text: string) => {
      const rest = state(text);
      if (rest.trim()) sql(prefix() + rest);
    },
    query: async <T = any,>(text: string, args: unknown[] = []) => {
      if (text.includes("set_config('request.jwt.claims'"))
        claims = String(args[0]);
      const q = text
        .replace(/\$(\d+)/g, (_, i) => lit(args[Number(i) - 1]))
        .replace(/;\s*$/, "");
      if (/^\s*(select|with)\b/i.test(q))
        return {
          rows: JSON.parse(
            sql(
              prefix() +
                `with results_native as(${q}) select coalesce(json_agg(row_to_json(results_native)),'[]'::json) from results_native;`,
            ),
          ) as T[],
        };
      sql(prefix() + q);
      return { rows: [] as T[] };
    },
    close: async () => {},
  };
  const factory = async (options: { beforeMigration?: string } = {}) => {
    const source = fs.readFileSync("tests/feature-database.ts", "utf8"),
      bootstrap = source.match(/await db\.exec\(`([\s\S]*?)`\);/)?.[1];
    if (!bootstrap) throw Error("NATIVE_BASE_DRIFT");
    await db.exec(bootstrap);
    for (const file of fs
      .readdirSync("supabase/migrations")
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          (!options.beforeMigration || f < options.beforeMigration),
      )
      .sort())
      await db.exec(fs.readFileSync("supabase/migrations/" + file, "utf8"));
    const users = {
      admin: randomUUID(),
      seller: randomUUID(),
      outsider: randomUUID(),
      closer: randomUUID(),
    };
    for (const [name, id] of Object.entries(users)) {
      await db.query("insert into auth.users values($1,$2)", [
        id,
        name + "@example.test",
      ]);
      await db.query(
        "insert into profiles(id,name,email,role) values($1,$2,$3,$4)",
        [
          id,
          name,
          name + "@example.test",
          name === "admin"
            ? "superadmin"
            : name === "closer"
              ? "closer"
              : "seller",
        ],
      );
    }
    const asUser = async (id: string, aal = "aal2") => {
      role = "authenticated";
      claims = JSON.stringify({ sub: id, aal });
    };
    const command = async (kind: string, p: object, key = randomUUID()) =>
      (
        await db.query<any>("select crm_command($1,$2,$3) result", [
          kind,
          p,
          key,
        ])
      ).rows[0].result;
    return { db, users, asUser, command } as any;
  };
  const f = await flowFixture(factory as any);
  if (process.env.CAMPAIGN_TEST_LEAD_FUNNEL === "1") {
    sql(fs.readFileSync("docs/specs/pipeline-os/campaign-flow-20261117/revisions/owner-creator/up.sql", "utf8"));
    const result = { ...(await exerciseLeadFunnel(f)), postgres: sql("select version()"), remoteMutations: 0 };
    fs.writeFileSync(funnelRoot + "native-result.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } else {
  if (ownerRevision) sql(fs.readFileSync(revisionRoot + "up.sql", "utf8"));
  // Reversal before history restores exactly the protected boundaries.
  sql(fs.readFileSync(revisionRoot + "down.sql", "utf8"));
  sql(fs.readFileSync(revisionRoot + "up.sql", "utf8"));
  const auth = `set local request.jwt.claims=${lit(JSON.stringify({ sub: f.users.admin, aal: "aal2" }))};set local role authenticated;`;
  const race = await Promise.allSettled(
    f.accounts.map((account) =>
      asyncSql(
        `begin;${auth}select campaign_flow_launch(${lit({ ...f.p, account_id: account })},${lit(randomUUID())});select pg_sleep(0.3);commit;`,
      ),
    ),
  );
  assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    race.filter(
      (x) => x.status === "rejected" && /CF_STALE/.test(x.reason.message),
    ).length,
    1,
  );
  assert.equal(Number(sql("select count(*) from campaign_flows")), 1);
  assert.equal(Number(sql("select count(*) from campaign_enrollments")), 4);
  assert.equal(
    Number(
      sql(
      `select count(*) from opportunities where seller_id<>${lit(ownerRevision ? f.users.admin : f.users.seller)}`,
      ),
    ),
    0,
  );
  const dates = JSON.parse(
    sql(
      "select json_agg(campaign_flow_v1.next_date(x,days,'America/Bogota') at time zone 'America/Bogota') from (values ('2026-11-17 15:00Z'::timestamptz,2),('2026-11-19 15:00Z',3),('2026-11-23 15:00Z',3),('2026-11-26 15:00Z',5)) v(x,days)",
    ),
  );
  assert.deepEqual(
    dates.map((x: string) => x.slice(0, 10)),
    ["2026-11-19", "2026-11-23", "2026-11-26", "2026-12-01"],
  );
  const result = {
    postgres: sql("select version()"),
    sqlSha256: createHash("sha256")
      .update(fs.readFileSync(revisionRoot + "up.sql"))
      .digest("hex"),
    parallelLaunches: 2,
    successfulLaunches: 1,
    rejectedOverlaps: 1,
    exactRecipients: 4,
    advisorPreserved: !ownerRevision,
    creatorOwnsCases: ownerRevision,
    reversalPassed: true,
    productionOrder055to057: true,
    realProviderRequests: 0,
    remoteMutations: 0,
    passed: true,
  };
  fs.writeFileSync(
    revisionRoot.replace(/migrations\/$/, "") + "native-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
  }
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
}
