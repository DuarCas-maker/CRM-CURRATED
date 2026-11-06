import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  abcFinalFixture,
  abcFinalRoot as root,
  abcSnapshot,
} from "./fixtures/pipeline-os-abc-final";
import {
  renderAbcFinalDiagnostic,
  finalDeclaration,
  diagnosticDeclaration,
  finalFailureGuard,
  diagnosticFailureGuard,
  finalReceiptSelect,
  diagnosticReceiptSelect,
} from "../scripts/pipeline-os/abc-final-diagnostic";
import {
  catalogPriorPins as pins,
  restoreCatalogPrior,
} from "../scripts/pipeline-os/abc-catalog-variants";

const load = async () => {
  const [currentMigration, currentContract, currentPostflight] =
    await Promise.all([
      readFile(
        root + "049_integrate_mail_identity_brands_and_bindings.sql",
        "utf8",
      ),
      readFile(root + "contract.json", "utf8"),
      readFile(root + "postflight.sql", "utf8"),
    ]);
  const { migration, contract } = await restoreCatalogPrior({
    migration: currentMigration,
    contract: currentContract,
    postflight: currentPostflight,
  });
  return {
    migration,
    contract,
    sql: renderAbcFinalDiagnostic(migration, contract),
  };
};
const crlf = (s: string) => s.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
type Fixture = Awaited<ReturnType<typeof abcFinalFixture>>;
const run = async (f: Fixture, sql: string) => {
  await f.admin();
  try {
    return await f.db.exec(sql);
  } catch (error) {
    // A batch client may stop at the exception before the terminal rollback.
    await f.db.exec("rollback");
    throw error;
  }
};
const rows = async (f: Fixture) => {
  await f.admin();
  return (
    await f.db.query(`select md5(jsonb_build_object(
      'contacts',(select jsonb_agg(to_jsonb(c) order by c.id) from public.contacts c),
      'accounts',(select jsonb_agg(to_jsonb(c) order by c.id) from public.mail_accounts c),
      'profiles',(select jsonb_agg(to_jsonb(c) order by c.id) from public.profiles c)
    )::text) digest`)
  ).rows;
};
const captureFailure = async (f: Fixture, sql: string) => {
  try {
    await run(f, sql);
    assert.fail("Expected contract mismatch");
  } catch (e) {
    const error = e as Error & { code: string; detail: string; hint: string };
    assert.equal(error.code, "P0001", error.message);
    assert.equal(error.message, "ABC_FINAL_CONTRACT_MISMATCH");
    const report = JSON.parse(error.detail);
    assert.equal(report.protocol, "AF-FDIAG-r1");
    assert.equal(report.sourceMigrationSha256, pins.migration);
    assert.equal(report.contractSha256, pins.contract);
    assert.equal(report.stage, "failed_before_commit");
    assert.equal(report.commitAllowed, false);
    assert.equal(report.allGuardsRetained, true);
    assert(error.hint.includes("ROLLBACK"));
    return report;
  }
};

test("FD-AC01/02: deterministic, revision-bound and reversible evidence-only changes", async () => {
  const { migration, contract, sql } = await load();
  assert.equal(
    sql,
    await readFile(root + "failure-diagnostic/diagnostic.rollback.sql", "utf8"),
  );
  const start = migration.lastIndexOf("do $af_check$");
  const bodyStart = sql.indexOf(migration.slice(0, 90));
  assert(bodyStart > 0);
  const restored = sql
    .slice(bodyStart)
    .replace(diagnosticDeclaration, finalDeclaration)
    .replace(
      diagnosticFailureGuard(pins.migration, pins.contract),
      finalFailureGuard,
    )
    .replace(
      diagnosticReceiptSelect(pins.migration, pins.contract),
      finalReceiptSelect,
    );
  assert.equal(restored, migration);
  assert.equal(
    sql.slice(bodyStart, bodyStart + start),
    migration.slice(0, start),
  );
  assert.match(sql, /rollback;\s*$/);
  assert(!sql.includes("pipeline_os_abc_application;\ncommit;"));
  assert.throws(
    () => renderAbcFinalDiagnostic(migration + " ", contract),
    /Unreviewed migration/,
  );
  assert.throws(
    () => renderAbcFinalDiagnostic(migration, contract + " "),
    /Unreviewed contract/,
  );
  assert.throws(
    () => renderAbcFinalDiagnostic(crlf(migration), contract),
    /Unreviewed migration/,
  );
});

test("FD-AC04/05: complete LF and CRLF diagnostics leave catalog and synthetic rows intact", async () => {
  const { sql } = await load();
  const f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f),
      beforeRows = await rows(f);
    for (const candidate of [sql, crlf(sql)]) {
      const output = (await run(f, candidate)).flatMap((r) => r.rows);
      const report = output.find((r: any) => r.pipeline_os_abc_final_diagnostic)
        ?.pipeline_os_abc_final_diagnostic as any;
      assert.equal(report.protocol, "AF-FDIAG-r1");
      assert.equal(report.stage, "checked_before_rollback");
      assert.equal(report.mismatchCount, 0);
      assert.equal(report.commitAllowed, false);
      assert.equal(report.protectedBefore, report.protectedAfter);
      assert.equal(report.sourceMigrationSha256, pins.migration);
      assert(!output.some((r: any) => r.pipeline_os_abc_application));
      assert.deepEqual(await abcSnapshot(f), before);
      assert.deepEqual(await rows(f), beforeRows);
    }
  } finally {
    await f.db.close();
  }
});

test("FD-AC02/03/05: exact code, ACL, view and column differences are reported without raw values", async () => {
  const { sql } = await load();
  const f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f),
      beforeRows = await rows(f);
    const cases = [
      {
        sql: sql.replace(
          "char_length(value) not between 1 and 120",
          "char_length(value) not between 1 and 119",
        ),
        group: "functions",
        object: "brand_b1.ref(text)",
        field: "sourceHash",
      },
      {
        sql: sql.replace(
          "do $af_check$",
          "grant execute on function composio_c1.mask(text) to anon;\ndo $af_check$",
        ),
        group: "functions",
        object: "composio_c1.mask(text)",
        field: "execute",
      },
      {
        sql: sql.replace(
          "do $af_check$",
          "alter view public.campaign_workspace set (security_invoker=false);\ndo $af_check$",
        ),
        group: "relations",
        object: "public.campaign_workspace",
        field: "options",
      },
      {
        sql: sql.replace(
          "do $af_check$",
          "alter table public.mail_accounts add column diagnostic_only text default 'SYNTHETIC_DO_NOT_REPORT_RAW_VALUE';\ndo $af_check$",
        ),
        group: "relations",
        object: "public.mail_accounts",
        field: "columns",
      },
    ];
    for (const c of cases) {
      assert.notEqual(c.sql, sql);
      const report = await captureFailure(f, c.sql);
      assert(
        report.details.some(
          (d: any) =>
            d.group === c.group && d.object === c.object && d.field === c.field,
        ),
        JSON.stringify(report),
      );
      assert(report.mismatchCount >= 1);
      assert(
        !JSON.stringify(report).includes("SYNTHETIC_DO_NOT_REPORT_RAW_VALUE"),
      );
      for (const d of report.details) {
        assert.deepEqual(
          Object.keys(d).sort(),
          [
            "expectedFingerprint",
            "field",
            "group",
            "object",
            "observedFingerprint",
          ].sort(),
        );
        assert.match(d.expectedFingerprint, /^[a-f0-9]{32}$/);
        assert.match(d.observedFingerprint, /^[a-f0-9]{32}$/);
      }
      assert.deepEqual(await abcSnapshot(f), before);
      assert.deepEqual(await rows(f), beforeRows);
    }
  } finally {
    await f.db.close();
  }
});

test("FD-AC02/03: inventory-only differences retain exact set rejection and bounded names", async () => {
  const { sql } = await load();
  const f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f);
    const extra = Array.from(
      { length: 25 },
      (_, n) =>
        `create function public.diagnostic_only_${n}() returns integer language sql as 'select 1';`,
    ).join("\n");
    const report = await captureFailure(
      f,
      sql.replace("do $af_check$", extra + "\ndo $af_check$"),
    );
    assert.equal(report.mismatchCount, 25);
    assert.equal(report.fieldMismatchCount, 0);
    assert.equal(report.functionInventory.ok, false);
    assert.equal(report.functionInventory.extraCount, 25);
    assert.equal(report.functionInventory.missingCount, 0);
    assert.equal(report.functionInventory.extraFirst20.length, 20);
    assert.equal(report.functionInventory.truncated, true);
    assert.deepEqual(await abcSnapshot(f), before);
  } finally {
    await f.db.close();
  }
});

test("FD-AC03/05: detail truncation retains the total and never converts failure to success", async () => {
  const { sql, contract } = await load();
  const f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f);
    const changes = Object.entries(JSON.parse(contract).post.functions)
      .filter(([, value]) => value !== null)
      .map(
        ([signature]) => `alter function ${signature} set search_path=public;`,
      )
      .join("\n");
    const report = await captureFailure(
      f,
      sql.replace("do $af_check$", changes + "\ndo $af_check$"),
    );
    assert(report.mismatchCount > 40);
    assert.equal(report.details.length, 40);
    assert.equal(report.detailsTruncated, true);
    assert.equal(report.functionInventory.ok, true);
    assert.deepEqual(await abcSnapshot(f), before);
  } finally {
    await f.db.close();
  }
});

test("FD-AC02: context and protected metadata guards remain unchanged", async () => {
  const { sql } = await load();
  const f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f);
    await f.db.exec("reset role");
    await assert.rejects(f.db.exec(sql), /ABC_CONTEXT_MISMATCH/);
    await f.db.exec("rollback");
    assert.deepEqual(await abcSnapshot(f), before);
    await assert.rejects(
      run(
        f,
        sql.replace(
          "do $af_check$",
          "alter function public.campaign_contact_summary(uuid) set search_path=public;\ndo $af_check$",
        ),
      ),
      /ABC_PROTECTED_METADATA_CHANGED/,
    );
    assert.deepEqual(await abcSnapshot(f), before);
  } finally {
    await f.db.close();
  }
});
