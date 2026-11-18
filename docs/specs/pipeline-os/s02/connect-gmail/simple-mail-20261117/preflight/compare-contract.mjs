import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const folder = path.dirname(fileURLToPath(import.meta.url)),
  root = path.resolve(folder, "../../../../../../..");
const { connectV2Fixture } = await import(
  pathToFileURL(path.join(root, "tests/fixtures/pipeline-os-s02-connect-v2.ts"))
    .href
);
const production = JSON.parse(
  await fs.readFile(path.join(folder, "catalog.json"), "utf8"),
);
const candidate = await fs.readFile(
  path.join(folder, "../simple-mail.local.sql"),
  "utf8",
);
const referenced = new Set(
  [
    ...candidate.matchAll(
      /\b(public|brand_b1|brand_b2|composio_c1|mail_runtime|mail_quota)\.([a-z_0-9]+)\s*\(/g,
    ),
  ].map((m) => m[1] + "." + m[2]),
);
const fixture = await connectV2Fixture();
try {
  await fixture.owner();
  const canonical = await fs.readFile(
    path.join(
      root,
      "docs/specs/pipeline-os/s02/release/quota-final/052_integrate_mail_quota_and_existing_bindings.sql",
    ),
    "utf8",
  );
  const start = canonical.indexOf("create table mail_quota.binding_contexts(");
  await fixture.db.exec(
    canonical.slice(start, canonical.indexOf("\ndo $qgr$", start)),
  );
  const local = (
    await fixture.db.query(
      "select n.nspname schema,p.proname name,p.oid::regprocedure::text signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) source_md5,p.prosecdef definer,p.proconfig config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','brand_b1','brand_b2','composio_c1','mail_runtime','mail_quota')",
    )
  ).rows.filter((f) => referenced.has(f.schema + "." + f.name));
  const checks = local.map((f) => {
    const remote = production.functions.find(
      (p) => p.signature === f.signature,
    );
    return {
      signature: f.signature,
      localHash: f.source_md5,
      productionHash: remote?.source_md5 ?? null,
      sourceMatch: remote?.source_md5 === f.source_md5,
      definerMatch: remote?.definer === f.definer,
      searchPathMatch:
        JSON.stringify(remote?.config) === JSON.stringify(f.config),
    };
  });
  const failures = checks.filter(
    (c) => !c.sourceMatch || !c.definerMatch || !c.searchPathMatch,
  );
  const report = {
    at: new Date().toISOString(),
    productionCapture: production.at,
    localFixture: "canonical synthetic post052; no remote execution",
    newSchemaAbsent: !production.schemas.includes("simple_mail"),
    candidateGuard: production.candidate_guard,
    checked: checks.length,
    failures,
    checks,
    remoteChanges: 0,
  };
  await fs.writeFile(
    path.join(folder, "contract-comparison.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      checked: checks.length,
      failures,
      newSchemaAbsent: report.newSchemaAbsent,
    }),
  );
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await fixture.db.close();
}
