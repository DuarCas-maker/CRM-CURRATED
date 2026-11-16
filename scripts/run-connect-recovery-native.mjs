// Derive an isolated PG15 assay from the pinned public harness, without editing it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const sourcePath = "tests/pipeline-os-s02-connect-v2-native.test.ts";
let source = fs.readFileSync(sourcePath, "utf8");
if (
  createHash("sha256").update(source).digest("hex") !==
  "cb333fd58a9877542474f2d7005c04b93882328ef58158f68d70656a97a6687a"
)
  throw Error("NATIVE_HARNESS_DRIFT");
const insertion = `
      await check("RECOVERY-PG15: additive install, independent quota and preserved expired source", async () => {
        const folder="docs/specs/pipeline-os/s02/connect-gmail/reconcile-20261116/";
        sql(readFileSync(join(root,folder,"recovery.delta.sql"),"utf8"));
        sql(readFileSync(join(root,folder,"recovery.rollback.sql"),"utf8"));
        sql(readFileSync(join(root,folder,"recovery.delta.sql"),"utf8"));
        const f=await begin(),e=await engine(f);
        await e.start(request(f));await load(f);
        const sourceId=f.snapshot.attempt.id;
        sql("update composio_connect.attempts set created_at=clock_timestamp()-interval '20 minutes',deadline=clock_timestamp()-interval '11 minutes' where id="+lit(sourceId));
        const oldDeadline=value("select deadline::text from composio_connect.attempts where id="+lit(sourceId));
        const proof=randomUUID(),id=randomUUID(),key=randomUUID();
        const payload={id,source_id:sourceId,expected_revision:f.snapshot.attempt.revision,request_key:key,
          authority:connectAuthority(session as any,proof),state_hash:connectDigest(randomUUID()),capability_hash:connectDigest(proof)};
        const execute=(operation:string,extra:Record<string,unknown>={})=>{
          const p={...payload,...extra};
          const ticket=JSON.parse(humanSql("public.composio_connect_recovery_authorize("+lit(operation)+","+json(p)+")"));
          return JSON.parse(serviceSql("public.composio_connect_recovery_execute("+lit(operation)+","+json(p)+","+json(ticket)+")"));
        };
        const tickets=[1,2].map(()=>JSON.parse(humanSql("public.composio_connect_recovery_authorize('begin',"+json(payload)+")")));
        const races=await Promise.allSettled(tickets.map(ticket=>sqlAsync("begin;set local role service_role;select public.composio_connect_recovery_execute('begin',"+json(payload)+","+json(ticket)+");commit;")));
        const winners=races.filter((r):r is PromiseFulfilledResult<string>=>r.status==='fulfilled');
        assert.equal(winners.length,1);assert.equal(races.filter(r=>r.status==='rejected').length,1);
        const started=JSON.parse(winners[0].value.trim());assert.equal(started.state,"verifying");
        const reserved=execute("reserve");if(reserved.wait_ms)await pause(reserved.wait_ms+10);
        execute("admit");
        assert.throws(()=>execute("admit"),/CONNECT_NOT_READY/);
        const identity={connected_account_id:started.connection_id,project_id:started.descriptor.config.project_id,
          auth_config_id:started.descriptor.config.auth_config_id,owner_id:started.descriptor.config.owner_id,
          primary_email:started.expected_email,toolkit:"gmail",active:true};
        const finished=execute("finish",{identity});assert.equal(finished.state,"completed");assert.equal(finished.child_id,id);
        assert.equal(execute("begin").child_id,id);
        assert.equal(value("select deadline::text from composio_connect.attempts where id="+lit(sourceId)),oldDeadline);
        assert.equal(value("select state from composio_connect_runtime.runtime where attempt_id="+lit(id)),"awaiting_brand");
        sql(readFileSync(join(root,"docs/specs/pipeline-os/s02/connect-gmail/registration-20261116/registration.sql"),"utf8"));
        sql(readFileSync(join(root,"docs/specs/pipeline-os/s02/connect-gmail/registration-20261116/rollback.sql"),"utf8"));
        sql(readFileSync(join(root,"docs/specs/pipeline-os/s02/connect-gmail/registration-20261116/registration.sql"),"utf8"));
        const review=value("select to_jsonb(v) from mail_account_brand_reviews v where id=(select review_id from composio_connect.attempts where id="+lit(id)+")");
        humanSql("public.crm_command('brand_mapping_confirm',"+json({review_id:review.id,expected_review_revision:review.revision,expected_account_revision:review.expected_account_revision,acknowledge_conflict:false})+","+lit(randomUUID())+")");
        sql("update composio_connect.attempts set deadline=created_at where id="+lit(id));
        const registration=JSON.parse(humanSql("public.composio_connect_recovery_candidate("+lit(sourceId)+",null,null)"));
        assert.equal(registration.state,"ready");const registrationKey=randomUUID();
        const approve="public.composio_connect_recovery_candidate("+lit(sourceId)+","+json(registration.expected)+","+lit(registrationKey)+")";
        const candidate=JSON.parse(humanSql(approve));assert.equal(candidate.state,"candidate");assert.equal(candidate.transport_active,false);
        assert.equal(JSON.parse(humanSql(approve)).binding_id,candidate.binding_id);
        assert.equal(value("select deadline=created_at from composio_connect.attempts where id="+lit(id)),true);
        assert.equal(value("select status from mail_provider_bindings where id="+lit(candidate.binding_id)),"candidate");
        assert.throws(()=>sql(readFileSync(join(root,"docs/specs/pipeline-os/s02/connect-gmail/registration-20261116/rollback.sql"),"utf8")),/CANDIDATE_RECEIPTS_MUST_BE_PRESERVED/);
        assert.equal(value("select count(*)::int from composio_recovery.runs where admitted_at is not null"),1);
        assert.equal(value("select has_table_privilege('authenticated','composio_recovery.runs','SELECT')"),false);
        assert.throws(()=>sql(readFileSync(join(root,folder,"recovery.rollback.sql"),"utf8")),/RECOVERY_EVIDENCE_MUST_BE_PRESERVED/);
      });
`;
const marker = '      await check(\n        "USE-N06:';
if (!source.includes(marker)) throw Error("NATIVE_INSERTION_POINT_DRIFT");
// The reviewed historical bootstrap comprises ordinals001–047; unrelated later migrations are not its fixture.
source = source.replace(
  ".filter((n) => /^\\d{3}_.*\\.sql$/.test(n))",
  ".filter((n) => /^\\d{3}_.*\\.sql$/.test(n) && Number(n.slice(0,3))<=47)",
);
source = source
  .replace(marker, insertion + marker)
  .replaceAll(
    '"../src/',
    JSON.stringify(pathToFileURL(path.resolve("src") + path.sep).href).slice(
      0,
      -1,
    ),
  );
const runtime = path.resolve(".local/recovery-native");
fs.mkdirSync(runtime, { recursive: true });
const target = path.join(runtime, "derived-native.ts");
fs.writeFileSync(target, source);
const tsx = import.meta.resolve("tsx"),
  offline = pathToFileURL(path.resolve("tests/offline.mjs")).href;
const pg = path.resolve("../toolchains/postgresql-15.19/pgsql/bin");
if (!fs.existsSync(path.join(pg, "postgres.exe")))
  throw Error("NATIVE_POSTGRES_UNAVAILABLE");
const output = fs.openSync(
  "docs/specs/pipeline-os/s02/connect-gmail/reconcile-20261116/native-tests.txt",
  "w",
);
const child = spawn(
  process.execPath,
  ["--import", offline, "--import", tsx, "--test", target],
  {
    env: {
      ...process.env,
      PIPELINE_OS_CONNECT_V2_NATIVE: "1",
      PIPELINE_OS_CONNECT_PG_BIN: pg,
    },
    windowsHide: true,
    stdio: ["ignore", output, output],
  },
);
child.on("exit", (code) => {
  fs.closeSync(output);
  console.log(
    JSON.stringify({
      nativeExit: code,
      derivedHarness: target,
      productionOperations: 0,
    }),
  );
  process.exitCode = code ?? 1;
});
