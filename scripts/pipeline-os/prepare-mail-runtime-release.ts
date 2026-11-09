import assert from "node:assert/strict";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { abcFinalFixture } from "../../tests/fixtures/pipeline-os-abc-final";
import {
  runtimeReleaseRoot as root,
  runtimeMigration,
  runtimeSources,
  runtimeCatalog,
  runtimeDdl,
  runtimeDiff,
  renderRuntimeRelease,
  hash,
  type Snapshot,
  type RuntimeContract,
} from "./mail-runtime-release";

// Local-only artifact generator: dedicated synthetic in-memory PostgreSQL.
// No environment, remote client, provider, subprocess or real credentials.
export async function prepareRuntimeRelease() {
  const numbered = (await readdir("supabase/migrations")).filter((p) =>
    /^050_/.test(p),
  );
  assert.equal(numbered.length, 0, "050 already allocated in migrations");
  const sources = await Promise.all(
    runtimeSources.map(async ([path, marker]) => {
      const b = await readFile(path);
      return {
        path,
        sha256: hash(b),
        bytes: b.length,
        transformation: marker.startsWith("create schema")
          ? "replace_disposable_host_wrapper_and_transaction_plus_declared_MR_AUTH_overlay"
          : "remove_only_fixture_marker_line",
      };
    }),
  );
  const inputs = await Promise.all(
      runtimeSources.map(([p]) => readFile(p, "utf8")),
    ),
    ddl = runtimeDdl(inputs);
  const old = await readFile(
    "docs/specs/pipeline-os/s02/release/abc-final/049_integrate_mail_identity_brands_and_bindings.sql",
  );
  assert.equal(
    hash(old),
    "1ee6dab9911777f4fae3f912ad6a679d17ad9fb88e79ae8479f20df541171f39",
  );
  const f = await abcFinalFixture(true);
  try {
    await f.admin();
    await f.db.exec(old.toString());
    await f.db.exec(
      "create table auth.sessions(id uuid primary key,user_id uuid references auth.users,created_at timestamptz not null default now(),refreshed_at timestamp without time zone default timezone('UTC',now()),not_after timestamptz)",
    );
    await f.db.exec("set search_path=pg_catalog,pg_temp");
    const snapshot = async () =>
      (await f.db.query<{ snapshot: Snapshot }>(runtimeCatalog)).rows[0]
        .snapshot;
    const before = await snapshot();
    await f.db.exec("begin");
    await f.db.exec(ddl);
    const after = await snapshot();
    await f.db.exec("rollback");
    assert.deepEqual(await snapshot(), before, "component rehearsal rollback");
    // Same logical final catalog for both supported Auth column representations.
    await f.db.exec(
      "alter table auth.sessions alter column refreshed_at type timestamptz using refreshed_at at time zone 'UTC'",
    );
    await f.db.exec("begin");
    await f.db.exec(ddl);
    assert.deepEqual(
      await snapshot(),
      after,
      "Auth type must not change the generated final contract",
    );
    await f.db.exec("rollback");
    const { pre, post } = runtimeDiff(before, after),
      dependencies: Snapshot = { relations: {}, functions: {} };
    // Scope only the actual existing dependencies of the six DDL components.
    // Unrelated platform objects are preserved dynamically, not assumed canonical.
    const referenced = new Set(
      [
        ...ddl.matchAll(
          /\b(public|brand_b1|brand_b2|s01_i02|composio_c1)\.([a-z_][a-z0-9_]*)/g,
        ),
      ].map((m) => m[1] + "." + m[2]),
    );
    for (const [g, values] of Object.entries(before))
      if (g in dependencies)
        for (const [k, v] of Object.entries(values))
          if (referenced.has(k.split("(")[0]) && !(k in pre[g])) {
            // Views referenced by other inherited code are not rewritten/certified here.
            if (g === "relations" && (v as { kind: string }).kind !== "r")
              continue;
            dependencies[g][k] = v;
          }
    const contract: RuntimeContract = {
      protocol: "MR-FINAL-r1",
      ordinal: "050",
      sources,
      accepted049: hash(old),
      authCompatibility: {
        revision: "MR-AUTH-r1",
        naiveRefreshedAtZone: "UTC",
        originalSourcesUnchanged: true,
        overlay: [
          "two private refreshed_at_utc overloads before T002 digest",
          "T002 live_actor inactivity expression",
          "T009 session_limit inactivity expression",
        ],
      },
      pre,
      post,
      dependencies,
    };
    const artifacts = renderRuntimeRelease(contract, ddl);
    await mkdir(root, { recursive: true });
    for (const [p, s] of [
      ["contract.json", artifacts.contract],
      [runtimeMigration, artifacts.migration],
      ["preflight.sql", artifacts.preflight],
      ["postflight.sql", artifacts.postflight],
    ])
      await writeFile(root + p, s);
    console.log(
      JSON.stringify({
        protocol: contract.protocol,
        ordinal: contract.ordinal,
        components: sources.length,
        changes: Object.fromEntries(
          Object.entries(post).map(([g, v]) => [g, Object.keys(v).length]),
        ),
        dependencies: Object.fromEntries(
          Object.entries(dependencies).map(([g, v]) => [
            g,
            Object.keys(v).length,
          ]),
        ),
        contractSha256: hash(artifacts.contract),
        remoteSql: 0,
        realProviderRequests: 0,
      }),
    );
    return artifacts;
  } finally {
    await f.db.close();
  }
}
if (
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/prepare-mail-runtime-release.ts")
)
  await prepareRuntimeRelease();
