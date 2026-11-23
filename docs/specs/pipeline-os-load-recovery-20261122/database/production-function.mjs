// No credentials are loaded by this file. Default --plan is entirely offline.
// --execute/--rollback require new explicit approval including environment reuse.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = "docs/specs/pipeline-os-load-recovery-20261122/database/";
const manifest = JSON.parse(
  await readFile(root + "release-manifest.json", "utf8"),
);
const rollback = process.argv.includes("--rollback");
const file = rollback ? manifest.rollback : manifest.migration;
const expected = rollback ? manifest.after : manifest.before;
const next = rollback ? manifest.before : manifest.after;
if (!process.argv.includes("--execute")) {
  console.log(
    JSON.stringify(
      {
        target: manifest.target,
        mode: "plan",
        object: manifest.object,
        file,
        expected,
        next,
        backup: "private function definition and attributes only",
        clientRowsWritten: false,
      },
      null,
      2,
    ),
  );
} else {
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (
    origin.origin !== manifest.target ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw Error("RELEASE_TARGET_MISMATCH");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error("RELEASE_CREDENTIAL_UNAVAILABLE");
  async function query(sql) {
    const response = await fetch(new URL("/pg/query", origin), {
      method: "POST",
      redirect: "error",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ query: sql }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw Error("RELEASE_HTTP_" + response.status);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw Error("RELEASE_RESPONSE_INVALID");
    return rows;
  }
  const catalog = `begin read only;set local statement_timeout='5s';
    select current_database() as database,md5(p.prosrc) as hash,
      pg_get_functiondef(p.oid) as definition,to_jsonb(p)-'prosrc' as attributes
    from pg_proc p where oid=to_regprocedure('s01_i02.visible_conversations()');rollback;`;
  const before = (await query(catalog))[0];
  if (before?.database !== "postgres" || before?.hash !== expected)
    throw Error("RELEASE_SOURCE_DRIFT");
  const directory = resolve(
    ".local/pipeline-os-load-recovery-20261122/database",
  );
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backup = resolve(directory, `private-function-backup-${stamp}.json`);
  await writeFile(backup, JSON.stringify(before, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const stored = JSON.parse(await readFile(backup, "utf8"));
  if (stored.hash !== expected || stored.definition !== before.definition)
    throw Error("RELEASE_BACKUP_FAILED");
  const start = performance.now();
  await query(await readFile(file, "utf8"));
  const after = (await query(catalog))[0];
  if (
    after?.hash !== next ||
    JSON.stringify(after.attributes) !== JSON.stringify(before.attributes)
  )
    throw Error("RELEASE_POSTFLIGHT_FAILED");
  const receipt = {
    target: manifest.target,
    mode: rollback ? "rollback" : "apply",
    object: manifest.object,
    before: before.hash,
    after: after.hash,
    duration_ms: Math.round(performance.now() - start),
    backupVerified: true,
    attributesUnchanged: true,
    clientRowsWritten: false,
  };
  await writeFile(
    resolve(directory, `production-receipt-${stamp}.json`),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt, null, 2));
}
