import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  abcFinalFixture,
  abcFinalRoot as root,
  abcSnapshot,
} from "./fixtures/pipeline-os-abc-final";
import {
  catalogPriorPins,
  deriveCatalogVariants,
  inheritedLineage,
  qualifyFinalView,
  receivedFingerprints,
  restoreCatalogPrior,
  reviseCatalogArtifacts,
} from "../scripts/pipeline-os/abc-catalog-variants";
import { renderAbcFinalDiagnostic } from "../scripts/pipeline-os/abc-final-diagnostic";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const crlf = (s: string) => s.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
const load = async () => {
  const [migration, postflight, contract, evidence] = await Promise.all([
    readFile(
      root + "049_integrate_mail_identity_brands_and_bindings.sql",
      "utf8",
    ),
    readFile(root + "postflight.sql", "utf8"),
    readFile(root + "contract.json", "utf8"),
    readFile(root + "catalog-variants/evidence.json", "utf8"),
  ]);
  return {
    artifacts: { migration, postflight, contract },
    d: JSON.parse(contract),
    evidence: JSON.parse(evidence),
  };
};
type Fixture = Awaited<ReturnType<typeof abcFinalFixture>>;
const run = async (f: Fixture, sql: string) => {
  await f.admin();
  try {
    return await f.db.exec(sql);
  } catch (e) {
    await f.db.exec("rollback");
    throw e;
  }
};
/** Explicit simulation of the five observed PG15 view strings, not native QA. */
function simulateObservedViews(
  sql: string,
  variants: Record<string, string[]>,
  finalTag: string,
) {
  const start = sql.lastIndexOf(finalTag);
  assert(start >= 0);
  const tail = sql.slice(start),
    needle = "md5(pg_get_viewdef(c.oid,false))";
  assert.equal(tail.split(needle).length - 1, 1);
  const value =
    "(case n.nspname||'.'||c.relname " +
    Object.entries(variants)
      .map(([k, v]) => `when '${k}' then '${v[1]}'`)
      .join(" ") +
    " else " +
    needle +
    " end)";
  return sql.slice(0, start) + tail.replace(needle, value);
}
async function useInheritedSources(f: Fixture, d: any) {
  await f.admin();
  for (const [key, base] of Object.entries(inheritedLineage)) {
    const definition = (
      await f.db.query<{ sql: string }>(
        "select pg_get_functiondef($1::regprocedure) sql",
        [base],
      )
    ).rows[0].sql;
    await f.db.exec(crlf(definition));
    const hash = (
      await f.db.query<{ hash: string }>(
        "select md5(prosrc) hash from pg_proc where oid=$1::regprocedure",
        [base],
      )
    ).rows[0].hash;
    assert(d.sourceVariants[base].includes(hash));
    assert.equal(md5(JSON.stringify(hash)), receivedFingerprints[key]);
  }
}

test("CV-AC01/02/03: all fourteen observations have exact provenance and the prior revision reconstructs byte for byte", async () => {
  const { artifacts, d, evidence } = await load();
  const prior = await restoreCatalogPrior(artifacts),
    previous = JSON.parse(prior.contract);
  assert.equal(sha(prior.migration), catalogPriorPins.migration);
  const derived = deriveCatalogVariants(previous, evidence.views);
  assert.equal(Object.keys(d.postSourceVariants).length, 126);
  assert.equal(Object.keys(d.postInheritedSourceLineage).length, 9);
  assert.equal(Object.keys(d.postViewVariants).length, 5);
  assert.deepEqual(d.postInheritedSourceLineage, inheritedLineage);
  assert.deepEqual(d.postViewVariants, derived.viewVariants);
  for (const [key, base] of Object.entries(inheritedLineage))
    assert.deepEqual(d.postSourceVariants[key], d.sourceVariants[base]);
  assert.deepEqual(d.changed, previous.changed);
  assert.deepEqual(d.protectedSourceVariants, previous.protectedSourceVariants);
  assert.deepEqual(
    await reviseCatalogArtifacts(prior, evidence.views),
    artifacts,
  );
  assert.throws(() => qualifyFinalView("public.other", "select 1"));
  const altered = structuredClone(evidence.views);
  altered[0].definition += " ";
  assert.throws(() => deriveCatalogVariants(previous, altered));
});

test("CV-AC02/04: each complete qualified definition parses back to the same canonical view in the synthetic engine", async () => {
  const { artifacts, evidence, d } = await load();
  const f = await abcFinalFixture();
  try {
    await run(f, artifacts.migration);
    await f.db.exec("set search_path=pg_catalog,pg_temp");
    for (const view of evidence.views) {
      assert.equal(md5(view.definition), d.postViewVariants[view.key][0]);
      assert.equal(
        md5(view.qualifiedDefinition),
        d.postViewVariants[view.key][1],
      );
      let parsedCanonical: string | undefined;
      for (const definition of [view.definition, view.qualifiedDefinition]) {
        await f.db.exec("create temporary view cv_roundtrip as " + definition);
        const result = (
          await f.db.query<{ sql: string }>(
            "select pg_get_viewdef('pg_temp.cv_roundtrip'::regclass,false) sql",
          )
        ).rows[0].sql;
        // The source function's composite type acquired more columns after the
        // original view was created. Compare the two reparsed definitions,
        // which see the same current composite type, rather than its old RTE.
        if (parsedCanonical === undefined) parsedCanonical = result;
        else assert.equal(result, parsedCanonical);
        await f.db.exec("drop view pg_temp.cv_roundtrip");
      }
    }
  } finally {
    await f.db.close();
  }
});

test("CV-AC01/02/04: reproduce the fourteen reported mismatches, then accept exact inherited and qualified variants with LF and CRLF", async () => {
  const { artifacts, d } = await load();
  const prior = await restoreCatalogPrior(artifacts);
  for (const style of ["LF", "CRLF"]) {
    const f = await abcFinalFixture();
    try {
      await useInheritedSources(f, d);
      const before = await abcSnapshot(f);
      if (style === "LF") {
        const diagnostic = simulateObservedViews(
          renderAbcFinalDiagnostic(prior.migration, prior.contract),
          d.postViewVariants,
          "do $af_check$",
        );
        await assert.rejects(run(f, diagnostic), (e: any) => {
          assert.equal(e.message, "ABC_FINAL_CONTRACT_MISMATCH");
          const report = JSON.parse(e.detail);
          assert.equal(report.fieldMismatchCount, 14);
          assert.equal(report.functionInventory.ok, true);
          for (const row of report.details)
            assert.equal(
              row.observedFingerprint,
              receivedFingerprints[row.object],
            );
          return true;
        });
        assert.deepEqual(await abcSnapshot(f), before);
      }
      let candidate = simulateObservedViews(
        artifacts.migration,
        d.postViewVariants,
        "do $af_check$",
      );
      if (style === "CRLF") candidate = crlf(candidate);
      const app = (await run(f, candidate))
        .flatMap((r) => r.rows)
        .find((r: any) => r.pipeline_os_abc_application)
        ?.pipeline_os_abc_application as any;
      assert(app.targetsOk && app.preservationMatches);
      assert.equal(app.protectedBefore, app.protectedAfter);
      for (const post of [
        artifacts.postflight,
        simulateObservedViews(
          artifacts.postflight,
          d.postViewVariants,
          "do $af_post$",
        ),
      ]) {
        const result = (await run(f, style === "CRLF" ? crlf(post) : post))
          .flatMap((r) => r.rows)
          .find((r: any) => r.pipeline_os_abc_postflight)
          ?.pipeline_os_abc_postflight as any;
        assert(result.rolesOk && result.targetsOk);
        assert.equal(result.protectedFingerprint, app.protectedAfter);
      }
    } finally {
      await f.db.close();
    }
  }
});

test("CV-AC02/04: unknown source, changed view logic, view security and function grants still reject and roll back", async () => {
  const { artifacts, evidence } = await load();
  const f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f);
    const archive = evidence.views.find(
      (v: any) => v.key === "public.mail_archive_visible",
    );
    const changes = [
      "do $cv$declare definition text;begin select pg_get_functiondef('public.mark_sent_v15(uuid,text,text)'::regprocedure) into definition;execute replace(definition,chr(10),chr(10)||' ');end$cv$;",
      "create or replace view public.mail_archive_visible with(security_invoker=true) as " +
        archive.qualifiedDefinition.replace(/;\s*$/, " where false;"),
      "alter view public.mail_archive_visible set (security_invoker=false);",
      "grant execute on function public.mark_sent_before_brand_b2(uuid,text,text) to anon;",
    ];
    for (const change of changes) {
      const mutated = artifacts.migration.replace(
        "do $af_check$",
        change + "\ndo $af_check$",
      );
      await assert.rejects(run(f, mutated), /ABC_FINAL_CONTRACT_MISMATCH/);
      assert.deepEqual(await abcSnapshot(f), before);
    }
  } finally {
    await f.db.close();
  }
});

test("CV-AC02/04: final view variants cannot satisfy a precondition or hide changed columns", async () => {
  const { artifacts } = await load();
  const f = await abcFinalFixture();
  try {
    const before = await abcSnapshot(f);
    const mutated = artifacts.migration.replace(
      "do $af_check$",
      "alter view public.mail_archive_visible rename column subject to cv_changed_subject;\ndo $af_check$",
    );
    await assert.rejects(run(f, mutated), /ABC_FINAL_CONTRACT_MISMATCH/);
    assert.deepEqual(await abcSnapshot(f), before);
    await f.admin();
    await f.db.exec(
      "alter view public.campaign_workspace set (security_invoker=false)",
    );
    const drift = await abcSnapshot(f);
    await assert.rejects(
      run(f, artifacts.migration),
      /ABC_BASE_CONTRACT_MISMATCH/,
    );
    assert.deepEqual(await abcSnapshot(f), drift);
  } finally {
    await f.db.close();
  }
});
