// Reuse only authorized PG15 binaries; create a separate synthetic cluster in this checkout.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const root = process.cwd(),
  dest = path.resolve(".local/pipeline-os/qgr-i05");
assert.ok(
  process.env.PIPELINE_OS_QGR_PG_BIN,
  "Existing authorized PG15 binaries required; no installation",
);
fs.mkdirSync(dest, { recursive: true });
let source = fs.readFileSync(
  "tests/pipeline-os-s02-quota-i04-db.test.ts",
  "utf8",
);
source = source.slice(0, source.indexOf("      const i04 = read("));
source = source
  .replace("const prefix =", "let prefix =")
  .replace(
    "      const migrations =",
    "      prefix += 'set role supabase_admin;';\n      const migrations =",
  );
source = source.replace(
  "      for (const [path, startMark, endMark] of [",
  `      const prm=JSON.parse(read('docs/specs/pipeline-os/s02/release/permission-remediation/final/release-contract.json'));
      for(const target of prm.targets){sql('revoke all on table '+target.key+' from anon,authenticated;'+(target.authenticated.length?'grant '+target.authenticated.join(',')+' on table '+target.key+' to authenticated;':''));}
      for (const [path, startMark, endMark] of [`,
);
source = source
  .replaceAll(
    "QGR-I04 native PG15: binding v2 and runtime",
    "I05 exact final SQL native PG15",
  )
  .replaceAll("PIPELINE_OS_QGR_I04_NATIVE", "PIPELINE_OS_QGR_I05_NATIVE")
  .replaceAll("qgr-i04", "qgr-i05")
  .replaceAll("qgr_i02_i04_", "qgr_i05_")
  .replaceAll('"../src/', '"../../../src/');
source += `      const oldPage=human('public.composio_binding_page('+lit(accountA)+')');
      human('public.composio_binding_command('+lit(accountA)+','+lit('register_candidate')+','+json({composio_project_id:'pr_fixture',auth_config_id:'ac_fixture',connected_account_id:'ca_old',composio_user_id:'old-owner',google_quota_project_id:'legacy-project',expected_head_revision:oldPage.head_revision,expected_account_revision:oldPage.account.account_revision,expected_brand_revision:oldPage.account.brand_revision,expected_context_hash:oldPage.account.context_hash})+','+lit(randomUUID())+')');
      sql("insert into public.gmail_api_usage values('qa-legacy',date_trunc('minute',now()),17)");
      sql(read('docs/specs/pipeline-os/s02/release/workspace-stats-compat-20261109/051_fix_workspace_stats_visible_mail.sql'));
      const release=await import(${JSON.stringify(pathToFileURL(path.resolve("docs/specs/pipeline-os/s02/release/quota-final/prepare.mjs")).href)});
      const original=template;db='qgr_i05_artifacts_'+suffix;sql('create database '+db+' template '+original,'postgres');
      const artifacts=release.prepare(sql);
      const runCase=async(name:string,fn:()=>void|Promise<void>)=>check(name,fn,false);
      const app=artifacts.files['052_integrate_mail_quota_and_existing_bindings.sql'];
      const pre=()=>JSON.parse(sql(artifacts.files['preflight.sql']));
      const post=()=>JSON.parse(sql(artifacts.files['postflight.sql']));
      await runCase('052 exact preflight/application/postflight preserve data and install unconfigured schema',()=>{
        const p=pre();assert.equal(p.catalogOk,true);assert.equal(p.queueOk,true);
        const result=JSON.parse(sql(app));assert.equal(result.targetsOk,true);assert.equal(result.preservationMatches,true);
        const r=post();assert.equal(r.targetsOk,true);assert.equal(r.initialStateOk,true);assert.equal(r.publicationReady,false);
        assert.throws(()=>sql(app),/QGR_BASE_MISMATCH/);sql('rollback;');
        const beforeData=operational();sql(artifacts.files['rollback-disabled-unused.sql']);assert.equal(operational(),beforeData);
        assert.equal(parse("select has_function_privilege('authenticated','public.composio_binding_command_v2(uuid,text,jsonb,uuid)','execute')"),false);
        assert.equal(parse("select count(*) from mail_quota.head"),1);
      });
      await runCase('052 metadata drift blocks before DDL with a bounded diagnostic',()=>{
        sql('grant select on public.mail_provider_bindings to authenticated');assert.equal(pre().catalogOk,false);
        assert.throws(()=>sql(app),/QGR_(BASE|DEPENDENCY)_MISMATCH/);assert.equal(parse("select to_regnamespace('mail_quota') is null"),true);
      });
      await runCase('052 wrong context cannot apply',()=>{
        const result=bin('psql',args(),"set role authenticated;"+app);assert.fail(result);
      }).catch(()=>{});
      await runCase('052 work in flight blocks before DDL',()=>{
        sql("insert into public.jobs(kind,payload,status,dedupe_key) values('gmail_sync','{}','running','i05-flight-fixture')");assert.equal(pre().queueOk,false);
        assert.throws(()=>sql(app),/QGR_NOT_QUIESCENT/);assert.equal(parse("select to_regnamespace('mail_quota') is null"),true);
      });
      await runCase('052 used policy prevents the unused-state rollback',()=>{
        sql(app);human(publishCall(policy(1,'disabled')));assert.throws(()=>sql(artifacts.files['rollback-disabled-unused.sql']),/QGR_ROLLBACK_SCOPE_ALREADY_USED/);assert.equal(parse('select count(*) from mail_quota.policies'),1);
      });
      await runCase('052 exact SQL rolls back catalog and operational data atomically',()=>{
        const before=JSON.parse(sql(release.catalog)),data=operational();sql(app.replace(/commit;\\s*$/,'rollback;'));
        assert.deepEqual(JSON.parse(sql(release.catalog)),before);assert.equal(operational(),data);
      });
      writeFileSync(join(runRoot,'result.json'),JSON.stringify({protocol:'QGR-I05-PG15-r1',postgres:context.version,passed,failed:sequence-passed.length,clusterStopped:false,providerCalls:0,remoteChanges:0,instantlyConsumed:43,contractSha256:artifacts.digest},null,2));
    } finally {
      if(started||existsSync(join(cluster,'postmaster.pid'))){bin('pg_ctl',['-D',cluster,'-m','fast','-w','stop']);const p=join(runRoot,'result.json');if(existsSync(p)){const r=JSON.parse(read(p));r.clusterStopped=true;writeFileSync(p,JSON.stringify(r,null,2));}}
    }
  },
);
`;
// The negative case must assert a failure, never swallow a failed test.
source = source
  .replace(
    `        const result=bin('psql',args(),"set role authenticated;"+app);assert.fail(result);`,
    `        assert.throws(()=>sql("reset role;set role authenticated;"+app),/QGR_CONTEXT_MISMATCH/);assert.equal(parse("select to_regnamespace('mail_quota') is null"),true);`,
  )
  .replace("      }).catch(()=>{});", "      });");
const file = path.join(dest, "native.test.ts");
fs.writeFileSync(file, source);
const env = {
  SystemRoot: process.env.SystemRoot,
  COMSPEC: process.env.COMSPEC,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  PATH:
    path.dirname(process.execPath) + ";" + process.env.SystemRoot + "/System32",
  PIPELINE_OS_QGR_PG_BIN: process.env.PIPELINE_OS_QGR_PG_BIN,
  PIPELINE_OS_QGR_I05_NATIVE: "1",
  NODE_ENV: "test",
};
const r = spawnSync(process.execPath, ["--import", "tsx", "--test", file], {
  cwd: root,
  env,
  windowsHide: true,
  encoding: "utf8",
  timeout: 240000,
  maxBuffer: 12 * 1024 * 1024,
});
fs.writeFileSync(path.join(dest, "native.tap"), r.stdout ?? "");
fs.writeFileSync(path.join(dest, "native.stderr"), r.stderr ?? "");
process.stdout.write(r.stdout ?? "");
if (r.stderr) process.stderr.write(r.stderr);
process.exitCode = r.status ?? 1;
