import { isDeepStrictEqual } from "node:util";
import {
  Config,
  Engine,
  Session,
  Side,
  Bundle,
  Report,
  QaError,
  demand,
  dbName,
  markerValue,
  literal as lit,
  identifier as ident,
  success,
  one,
  validateConfig,
  validateIdentity,
} from "./types";
import {
  globalsSql,
  nativeFixture,
  snapshotSql,
  admin,
  seedOutbox,
  ids,
  asUser,
  captureLocks,
} from "./fixture";
import { bundleFromFiles, pins } from "./artifacts";
import { hash } from "./types";

export async function runRehearsal(
  raw: unknown,
  workspace: string,
  bundle: Bundle,
  engine: Engine,
): Promise<Report> {
  const c = validateConfig(raw, workspace);
  const report: Report = {
    protocol: "PG-EXEC-r1",
    mode: engine.mode,
    cases: [],
    nativeTestsExecuted: 0,
    publicationReady: false,
    finished: false,
    instantly: { consumed: 43, new: 0 },
    clustersStopped: false,
  };
  const sessions = new Set<Session>();
  let failed = false;
  let touched = false;
  const open = async (database: string, side: Side = "primary") => {
    const s = await engine.connect(side, database);
    try {
      validateIdentity(c, side, database, s.identity);
    } catch (e) {
      await s.close();
      throw e;
    }
    sessions.add(s);
    return s;
  };
  const close = async (s: Session) => {
    try {
      await s.close();
    } finally {
      sessions.delete(s);
    }
  };
  const query = async (
    database: string,
    sql: string,
    side: Side = "primary",
  ) => {
    const s = await open(database, side);
    try {
      return await s.sql(sql);
    } finally {
      await close(s);
    }
  };
  const command = async (
    database: string,
    sql: string,
    side: Side = "primary",
  ) => success(await query(database, sql, side));
  const snapshot = async (
    database: string,
    shape?: Record<string, string[]>,
    side: Side = "primary",
  ) =>
    one(await query(database, snapshotSql(bundle, shape), side), "qa_snapshot");
  const full = async (database: string, side: Side = "primary") => {
    const s = await snapshot(database, undefined, side);
    return snapshot(database, s.shape, side);
  };
  const equal = (a: unknown, b: unknown, tag: string) =>
    demand(isDeepStrictEqual(a, b), tag);
  const base = dbName(c, "base"),
    positive = dbName(c, "positive");
  let baseSnapshot: any, finalSnapshot: any, receipt: any;
  const create = async (
    database: string,
    template?: string,
    side: Side = "primary",
  ) => {
    demand(database.startsWith(`abc049_${c.runId}_`), "QA_BAD_DATABASE");
    if (template) demand(template === base, "QA_BAD_TEMPLATE");
    await command(
      "postgres",
      `create database ${ident(database)}${template ? ` template ${ident(template)}` : " template template0"};
comment on database ${ident(database)} is ${lit(markerValue(c))};`,
      side,
    );
  };
  const clone = async (suffix: string) => {
    const name = dbName(c, suffix);
    await create(name, base);
    return name;
  };
  const apply = async (database: string, sql = bundle.migration) => {
    const s = await open(database);
    try {
      success(await s.sql(admin));
      return { s, answer: await s.sql(sql) };
    } catch (e) {
      await close(s);
      throw e;
    }
  };
  const application = async (database: string) => {
    const { s, answer } = await apply(database);
    try {
      const a = one(answer, "pipeline_os_abc_application");
      demand(
        a.protocol === "ABC-FINAL-r1" &&
          a.ordinal === "049" &&
          a.stage === "checked_before_commit" &&
          a.contractSha256 === bundle.contractSha &&
          a.targetsOk === true &&
          a.preservationMatches === true &&
          a.gmailProviderExpected === "gmail_oauth" &&
          a.composioEnabledExpected === false &&
          /^[a-f0-9]{32}$/.test(a.protectedBefore) &&
          a.protectedBefore === a.protectedAfter,
        "QA_APPLICATION_RECEIPT",
      );
      const p = await open(database);
      try {
        demand(p.identity.pid !== s.identity.pid, "QA_SAME_BACKEND");
        success(await p.sql(admin));
        const observed = one(
          await p.sql(bundle.postflight),
          "pipeline_os_abc_postflight",
        );
        demand(
          observed.protocol === "ABC-FINAL-r1" &&
            observed.ordinal === "049" &&
            observed.contractSha256 === bundle.contractSha &&
            observed.targetsOk === true &&
            observed.rolesOk === true &&
            observed.context?.readOnly === "on" &&
            observed.context.sqlRole === "supabase_admin" &&
            observed.context.searchPath === "pg_catalog, pg_temp" &&
            Number(observed.context.version) ===
              150000 + Number(c.runtimeVersion.split(".")[1]) &&
            observed.gmailProviderExpected === "gmail_oauth" &&
            observed.composioEnabledExpected === false &&
            observed.protectedFingerprint === a.protectedAfter,
          "QA_POSTFLIGHT_RECEIPT",
        );
        return a;
      } finally {
        await close(p);
      }
    } finally {
      await close(s);
    }
  };
  const rejection = async (database: string, sql: string, tokens: string[]) => {
    const before = await full(database);
    const { s, answer } = await apply(database, sql);
    await close(s);
    demand(
      answer.code !== 0 && tokens.includes(answer.token || ""),
      "QA_EXPECTED_REJECTION_MISSING",
    );
    equal(await full(database), before, "QA_REJECTION_CHANGED_STATE");
  };
  const caseRun = async (
    n: number,
    fn: () => Promise<void | Record<string, unknown>>,
  ) => {
    const id = `PG-AC${String(n).padStart(2, "0")}`;
    if (failed) {
      report.cases.push({
        id,
        status: "blocked",
        code: "QA_PREVIOUS_CASE_FAILED",
      });
      return;
    }
    if (engine.mode === "native") report.nativeTestsExecuted++;
    try {
      const observations = await fn();
      report.cases.push({
        id,
        status: "pass",
        ...(observations ? { observations } : {}),
      });
    } catch (e) {
      failed = true;
      report.cases.push({
        id,
        status: "fail",
        code: e instanceof QaError ? e.tag : "QA_UNEXPECTED_FAILURE",
      });
    }
  };
  const heldMigration = async (
    database: string,
    rowLock: boolean,
    race = false,
  ) => {
    const [a, b, observer] = await Promise.all([
      open(database),
      open(database),
      open(database),
    ]);
    try {
      demand(
        new Set([a.identity.pid, b.identity.pid, observer.identity.pid])
          .size === 3,
        "QA_SAME_BACKEND",
      );
      success(
        await a.sql(
          admin +
            "begin;" +
            (rowLock
              ? `select id from public.mail_accounts where id='${ids.account}' for update;`
              : "lock table public.mail_accounts in share mode;"),
        ),
      );
      success(await b.sql(admin));
      success(await observer.sql(admin));
      const running = b.sql(bundle.migration);
      let observed = false,
        lockCount = 0;
      // A polling pause yields the controller; waiting=true is the actual barrier.
      for (let i = 0; i < 60; i++) {
        const state = one(
          await observer.sql(captureLocks(b.identity.pid)),
          "qa_wait",
        );
        if (state.waiting === true) {
          observed = true;
          lockCount = state.locks.length;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      if (!observed) {
        await close(b);
        await running;
        throw new QaError("QA_NO_OBSERVED_CONTENTION");
      }
      if (race) {
        demand(
          !bundle.contract.lockRoots.includes("public.gmail_api_usage"),
          "QA_RACE_TARGET_LOCKED",
        );
        success(
          await observer.sql("grant select on public.gmail_api_usage to anon;"),
        );
        success(await a.sql("rollback;"));
        const result = await running;
        demand(
          result.code === 0 ||
            (result.code !== 0 &&
              [
                "ABC_LOCKED_CONTRACT_MISMATCH",
                "ABC_PROTECTED_METADATA_CHANGED",
                "ABC_FINAL_CONTRACT_MISMATCH",
              ].includes(result.token || "")),
          "QA_RACE_UNEXPECTED_FAILURE",
        );
        success(
          await observer.sql(
            "revoke select on public.gmail_api_usage from anon;",
          ),
        );
        return {
          observedWaiting: true,
          aborted: result.code !== 0,
          operationalDdlExclusionStillRequired: true,
        };
      }
      const result = await running;
      demand(
        result.code !== 0 && result.sqlState === "55P03",
        "QA_EXPECTED_LOCK_TIMEOUT",
      );
      success(await a.sql("rollback;"));
      return {
        observedWaiting: true,
        lockCount,
        observation: rowLock
          ? "table_lock_associated_with_row_lock_not_proof_of_implicit_FK_wait"
          : "explicit_root_contention",
      };
    } finally {
      await Promise.allSettled([close(a), close(b), close(observer)]);
    }
  };
  try {
    await caseRun(1, async () => {
      const verified = bundleFromFiles(bundle.files);
      demand(
        bundle.contractSha === pins.contract &&
          bundle.migrationSha === pins.migration &&
          bundle.migration === verified.migration &&
          bundle.postflight === verified.postflight &&
          bundle.preflight === verified.preflight &&
          isDeepStrictEqual(bundle.contract, verified.contract),
        "QA_INPUT_INTEGRITY",
      );
      for (const [p, h] of Object.entries(bundle.inputHashes))
        demand(
          bundle.files.has(p) && hash(bundle.files.get(p)!) === h,
          "QA_INPUT_HASH",
        );
      demand(nativeFixture(bundle).length === 52, "QA_FIXTURE_PLAN");
    });
    await caseRun(2, async () => {
      const identities = [];
      for (const side of ["primary", "recovery"] as const) {
        const s = await open("postgres", side);
        identities.push({
          version: s.identity.version,
          collation: s.identity.collation,
          serverBuild: s.identity.serverBuild || "not_supplied",
          timezone: s.identity.timezone || "not_supplied",
          lcCtype: s.identity.lcCtype || "not_supplied",
        });
        try {
          const fresh = one(
            await s.sql(
              "select jsonb_build_object('fresh',not exists(select 1 from pg_roles where rolname in('anon','authenticated','service_role','supabase_admin'))) qa_facts;",
            ),
            "qa_facts",
          );
          demand(fresh.fresh === true, "QA_CLUSTER_NOT_FRESH");
        } finally {
          await close(s);
        }
      }
      return {
        contexts: identities,
        controllerPlatform: process.platform,
        osMinorCollationParityNotAssumed: true,
      };
    });
    await caseRun(3, async () => {
      touched = true;
      await command("postgres", globalsSql);
      await create(base);
      for (const sql of nativeFixture(bundle)) await command(base, sql);
      const p = one(
        await query(base, admin + bundle.preflight),
        "pipeline_os_abc_preflight",
      );
      demand(
        p.complete === true &&
          p.catalogOk === true &&
          p.preconditionsOk === true &&
          p.mismatchCount === 0 &&
          p.contractSha256 === bundle.contractSha &&
          p.migrationSha256 === bundle.migrationSha,
        "QA_BASE_PREFLIGHT",
      );
      baseSnapshot = await full(base);
    });
    await caseRun(4, async () => {
      await create(positive, base);
      receipt = await application(positive);
      finalSnapshot = await full(positive);
    });
    await caseRun(5, async () => {
      const changes = [
        "create schema brand_b1;",
        "alter function public.account_delivery_usage(uuid) set search_path=public;",
        "grant select on public.mail_accounts to anon;",
        "alter table public.mail_accounts alter column email set default 'qa-drift';",
        "alter policy document_versions_read on public.document_versions using(true);",
      ];
      for (let i = 0; i < changes.length; i++) {
        const db = await clone("drift_" + i);
        await command(db, admin + changes[i]);
        await rejection(db, bundle.migration, [
          "ABC_BASE_CONTRACT_MISMATCH",
          "ABC_ALREADY_OR_PARTIALLY_INSTALLED",
        ]);
      }
    });
    await caseRun(6, async () => {
      const sending = await clone("sending");
      await command(sending, seedOutbox("sending"));
      await rejection(sending, bundle.migration, [
        "ABC_INFLIGHT_DRAIN_REQUIRED",
      ]);
      const legacy = await clone("legacy");
      await command(legacy, seedOutbox("queued") + seedOutbox("uncertain"));
      const before = await full(legacy);
      await application(legacy);
      equal(
        (await snapshot(legacy, before.shape)).rows,
        before.rows,
        "QA_LEGACY_ROWS_CHANGED",
      );
    });
    await caseRun(7, async () => {
      await rejection(positive, bundle.migration, [
        "ABC_ALREADY_OR_PARTIALLY_INSTALLED",
      ]);
    });
    await caseRun(8, async () => {
      const db = await clone("permissions");
      await application(db);
      const low = await query(
        db,
        asUser(ids.admin, "aal1") +
          `select public.crm_command('brand_create','{"code":"QA_LOW","name":"Synthetic","active":true}','${ids.document}');`,
      );
      demand(
        low.code !== 0 &&
          (low.token === "BRAND_FORBIDDEN" || low.sqlState === "42501"),
        "QA_MFA_GUARD",
      );
      await command(
        db,
        asUser(ids.admin) +
          `do $$declare b uuid;r uuid;begin
 b:=(public.crm_command('brand_create','{"code":"QA_NATIVE","name":"Synthetic","active":true}','10000000-0000-4000-8000-000000000011')->>'id')::uuid;
 r:=(public.crm_command('brand_mapping_propose',jsonb_build_object('account_id','${ids.account}','proposed_brand_id',b,'expected_account_revision',0,'evidence_reference','qa-reviewed'),'10000000-0000-4000-8000-000000000012')->>'id')::uuid;
 perform public.crm_command('brand_mapping_confirm',jsonb_build_object('review_id',r,'expected_review_revision',1,'expected_account_revision',0,'acknowledge_conflict',true),'10000000-0000-4000-8000-000000000013');
 perform public.crm_command('brand_membership_set',jsonb_build_object('brand_id',b,'user_id','${ids.seller}','active',true,'expected_revision',0),'10000000-0000-4000-8000-000000000014');end$$;`,
      );
      for (const [id, expected] of [
        [ids.seller, 1],
        [ids.outsider, 0],
      ] as const) {
        const facts = one(
          await query(
            db,
            asUser(id) +
              "select jsonb_build_object('visible',(select count(*) from public.operating_brands)) qa_facts;",
          ),
          "qa_facts",
        );
        demand(facts.visible === expected, "QA_RLS_GUARD");
      }
      for (const sql of [
        "reset role;set role anon;select * from public.operating_brands;",
        asUser(ids.seller) +
          `select public.composio_binding_check_finish('${ids.account}','x','y','{}');`,
      ]) {
        const r = await query(db, sql);
        demand(r.code !== 0 && r.sqlState === "42501", "QA_ROLE_BOUNDARY");
      }
    });
    await caseRun(9, async () => {
      equal(
        (await snapshot(positive, baseSnapshot.shape)).rows,
        baseSnapshot.rows,
        "QA_ORIGINAL_ROWS_CHANGED",
      );
      const facts = one(
        await query(
          positive,
          admin +
            `select jsonb_build_object('unassigned',exists(select 1 from public.documents where id='${ids.document}' and access_area is null),'derived',exists(select 1 from public.documents d join public.document_versions v on v.document_id=d.id where d.id='${ids.knownDocument}' and d.access_area='seller' and v.access_area='seller'),'brands',(select count(*) from public.operating_brands),'bindings',(select count(*) from public.mail_provider_bindings),'admissions',(select count(*) from public.mail_brand_dispatch_admissions)) qa_facts;`,
        ),
        "qa_facts",
      );
      demand(
        facts.unassigned === true &&
          facts.derived === true &&
          facts.brands === 0 &&
          facts.bindings === 0 &&
          facts.admissions === 0,
        "QA_UNEXPECTED_BOOTSTRAP",
      );
    });
    await caseRun(10, async () => {
      const db = await clone("rollback");
      demand(
        bundle.migration.split("do $af_check$").length === 2,
        "QA_INJECTION_MARKER",
      );
      const injected = bundle.migration.replace(
        "do $af_check$",
        "do $$begin raise exception 'QA_INJECTED_FAILURE';end$$;\ndo $af_check$",
      );
      await rejection(db, injected, ["QA_INJECTED_FAILURE"]);
    });
    for (const [number, rowLock] of [
      [11, false],
      [12, true],
    ] as const)
      await caseRun(number, async () => {
        const db = await clone(rowLock ? "row_lock" : "root_lock"),
          before = await full(db);
        const result = await heldMigration(db, rowLock);
        equal(await full(db), before, "QA_LOCK_FAILURE_CHANGED_STATE");
        // A new clone is an explicit follow-up, not retrying the failed transaction.
        await application(
          await clone(rowLock ? "row_released" : "root_released"),
        );
        return result;
      });
    await caseRun(13, async () => {
      await command("postgres", globalsSql, "recovery");
      for (const [label, source, expected] of [
        ["base", base, baseSnapshot],
        ["final", positive, finalSnapshot],
      ] as const) {
        const sha = await engine.backup("primary", source, label);
        demand(/^[a-f0-9]{64}$/.test(sha), "QA_ARCHIVE_HASH");
        const dest = dbName(c, "restored_" + label);
        await create(dest, undefined, "recovery");
        await engine.restore("recovery", dest, label, sha);
        equal(await full(dest, "recovery"), expected, "QA_RESTORE_STATE");
        if (label === "final") {
          const p = one(
            await query(dest, admin + bundle.postflight, "recovery"),
            "pipeline_os_abc_postflight",
          );
          demand(
            p.targetsOk === true &&
              p.rolesOk === true &&
              p.contractSha256 === bundle.contractSha &&
              p.protectedFingerprint === receipt.protectedAfter,
            "QA_RESTORE_POSTFLIGHT",
          );
        }
      }
    });
    await caseRun(14, async () =>
      heldMigration(await clone("ddl_race"), false, true),
    );
    await caseRun(15, async () => {
      const baseProbe = one(
        await query(
          base,
          "select jsonb_build_object('oldClaim',to_regprocedure('public.claim_outbox()') is not null,'newReady',to_regprocedure('public.brand_campaign_ready(uuid)') is not null) qa_facts;",
        ),
        "qa_facts",
      );
      demand(
        baseProbe.oldClaim === true && baseProbe.newReady === false,
        "QA_BASE_CALLERS",
      );
      const db = await clone("caller_probe");
      await command(db, seedOutbox("queued"));
      await application(db);
      const finalProbe = one(
        await query(
          db,
          "reset role;set role service_role;select jsonb_build_object('claimed',(select count(*) from public.claim_outbox()),'newReady',to_regprocedure('public.brand_campaign_ready(uuid)') is not null) qa_facts;",
        ),
        "qa_facts",
      );
      demand(
        finalProbe.claimed === 0 && finalProbe.newReady === true,
        "QA_LEGACY_DISPATCH",
      );
      return {
        base: baseProbe,
        final: finalProbe,
        binariesExecuted: false,
        mixedBinaryGateClosed: false,
      };
    });
  } finally {
    await Promise.allSettled([...sessions].map(close));
    let stopOk = true;
    if (touched && c.stopOwnedClusters)
      for (const side of ["primary", "recovery"] as const) {
        try {
          await engine.stop(side);
        } catch {
          stopOk = false;
        }
      }
    else stopOk = false;
    report.clustersStopped = stopOk;
    report.cases.push({
      id: "PG-AC16",
      status: stopOk ? "pass" : "blocked",
      ...(!stopOk ? { code: "QA_CLUSTER_STOP_NOT_CONFIRMED" } : {}),
    });
    if (engine.mode === "native") report.nativeTestsExecuted++;
    report.finished =
      report.cases.length === 16 &&
      report.cases.every((r) => r.status === "pass");
  }
  return report;
}
