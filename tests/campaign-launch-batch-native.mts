// Explicit local-only PostgreSQL15 assay. No provider, production DB or .env access.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, execFile } from "node:child_process";
import { flowOwnerFixture } from "./fixtures/campaign-flow-owner";
import {
  exerciseLaunchBatch,
  launchBatchRoot,
} from "./fixtures/campaign-launch-batch";
const bin =
  process.env.CAMPAIGN_TEST_PG_BIN ||
  path.resolve(".local/toolchains/postgresql-15/bin");
if (!fs.existsSync(path.join(bin, "postgres.exe")))
  throw Error("NATIVE_PG15_UNAVAILABLE");
const runtime = path.resolve(".local/readiness-native-" + randomUUID()),
  data = path.join(runtime, "data");
fs.mkdirSync(runtime, { recursive: true });
if (fs.existsSync(data)) throw Error("NATIVE_PG15_DATA_ALREADY_EXISTS");
const server = net.createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as net.AddressInfo).port;
await new Promise<void>((r) => server.close(() => r()));
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
        : Array.isArray(v) &&
            v.every((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))
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
      m = rest.match(/^\s*set role (authenticated|service_role|anon)\s*;?/i);
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

  const f = await flowOwnerFixture(factory);
  const semantic = await exerciseLaunchBatch(f);
  await db.exec("reset role");
  await db.exec(
    "insert into contacts(email,name,verification,monthly_income) select 'launch-volume-'||i||'@example.test','Synthetic volume lead','valid',50000 from generate_series(1,4000)i;insert into leads(contact_id,company,seller_id) select id,'Example volume'," +
      lit(f.users.seller) +
      " from contacts where email like 'launch-volume-%@example.test'",
  );
  await f.asUser(f.users.admin);
  const { fundingPreset } = await import("../src/lib/campaign-presets");
  const template = (
    await db.query<any>("select save_campaign_template($1,$2) id", [
      { ...fundingPreset, id: undefined },
      randomUUID(),
    ])
  ).rows[0].id;
  const ids = (
    await db.query<any>(
      "select id from contacts where email like 'launch-volume-%@example.test' order by id limit 100",
    )
  ).rows.map((x) => x.id);
  const p = { ...f.p, template_id: template, contact_ids: ids },
    key = randomUUID();
  settings.set("statement_timeout", "8s");
  const began = performance.now();
  await assert.rejects(f.launch(p, key), /statement timeout/);
  const beforeMs = Math.round(performance.now() - began);
  assert.equal(
    (await db.query<any>("select count(*)::int n from campaigns")).rows[0].n,
    1,
    "failed transaction leaves no partial campaign",
  );
  await db.exec("reset role");
  await db.exec(fs.readFileSync(launchBatchRoot + "up.sql", "utf8"));
  await f.asUser(f.users.admin);
  const afterBegan = performance.now();
  const launched = await f.launch(p, key),
    afterMs = Math.round(performance.now() - afterBegan);
  assert.equal(launched.selected, 100);
  assert(afterMs < 7000, "fits unchanged 8s database budget with margin");
  assert.deepEqual(await f.launch(p, key), launched);
  await db.exec("reset role");
  assert.equal(
    (await db.query<any>("select count(*)::int n from campaigns")).rows[0].n,
    2,
  );
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int n from campaign_enrollments where campaign_id=$1 and funding_income_snapshot=50000",
        [launched.id],
      )
    ).rows[0].n,
    100,
  );
  assert.equal(
    (await db.query<any>("select count(*)::int n from outbox")).rows[0].n,
    0,
  );
  const result = {
    passed: true,
    syntheticContacts: 4004,
    selected: 100,
    budgetMs: 8000,
    beforeTimeoutMs: beforeMs,
    afterLaunchMs: afterMs,
    semantic,
    noPartialCampaign: true,
    replaySameCampaign: true,
    providerRequests: 0,
    sqlSha256: createHash("sha256")
      .update(fs.readFileSync(launchBatchRoot + "up.sql"))
      .digest("hex"),
  };
  fs.writeFileSync(
    launchBatchRoot + "native-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
}
