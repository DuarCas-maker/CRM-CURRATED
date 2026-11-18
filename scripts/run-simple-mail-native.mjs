import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const base = "tests/pipeline-os-s02-connect-v2-native.test.ts";
let source = fs.readFileSync(base, "utf8");
if (
  createHash("sha256").update(source).digest("hex") !==
  "cb333fd58a9877542474f2d7005c04b93882328ef58158f68d70656a97a6687a"
)
  throw Error("NATIVE_BASE_DRIFT");
const insertion = `
      const legacyChecksPassed=results.length;
      sql("update public.profiles set active=true where id="+lit(fixture.actor));
      const simpleFolder="docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/";
      const simpleSql=readFileSync(join(root,simpleFolder,"simple-mail.local.sql"),"utf8");
      const simpleRollback=readFileSync(join(root,simpleFolder,"simple-mail.rollback.sql"),"utf8");
      await check("SIMPLE-PG01: additive install, unused reversal and reapply on native PG15",()=>{
        const canonical=readFileSync(join(root,"docs/specs/pipeline-os/s02/release/quota-final/052_integrate_mail_quota_and_existing_bindings.sql"),"utf8");
        const from=canonical.indexOf("create table mail_quota.binding_contexts("),to=canonical.indexOf("\\ndo $qgr$",from);
        assert(from>0&&to>from);sql(canonical.slice(from,to));
        sql(simpleSql);sql(simpleRollback);sql(simpleSql);
        assert.equal(value("select count(*)::int from pg_namespace where nspname='simple_mail'"),1);
      });
      const simpleEmail="native.simple@example.test",simpleKey=randomUUID(),simpleState=connectDigest(randomUUID());
      let simpleView:any;
      await check("SIMPLE-PG02: human MFA, service-only identity and automated brand/advisor setup",()=>{
        humanSql("public.crm_command('brand_create',"+json({code:"CURATED_FINANCIAL",name:"Curated Financial",active:true})+","+lit(randomUUID())+")");
        const call="public.simple_mail_begin("+json({email:simpleEmail,provider:"gmail_oauth",advisor_id:fixture.seller,idempotency_key:simpleKey})+","+lit(simpleState)+",'fixture-encrypted-state','fixture','example.test')";
        simpleView=JSON.parse(humanSql(call));assert.equal(JSON.parse(humanSql(call)).id,simpleView.id);
        assert.throws(()=>humanSql("public.simple_mail_direct_saved("+lit(simpleView.id)+","+lit(fixture.actor)+","+lit(simpleEmail)+",'fictional-encrypted-token')"),/permission denied/);
        assert.equal(humanSql("public.simple_mail_exchange_begin("+lit(simpleView.id)+")").trim(),'t');
        assert.equal(humanSql("public.simple_mail_exchange_begin("+lit(simpleView.id)+")").trim(),'f');
        serviceSql("public.simple_mail_direct_saved("+lit(simpleView.id)+","+lit(fixture.actor)+","+lit(simpleEmail)+",'fictional-encrypted-token')");
        humanSql("public.simple_mail_confirm("+lit(simpleView.id)+")");
        simpleView=JSON.parse(humanSql("public.simple_mail_finalize("+lit(simpleView.id)+")"));assert.equal(simpleView.state,"ready");
        assert.equal(value("select count(*)::int from outbox where account_id="+lit(simpleView.account_id)),0);
        assert.equal(value("select count(*)::int from mail_permissions where account_id="+lit(simpleView.account_id)+" and user_id="+lit(fixture.seller)+" and can_send"),1);
      });
      await check("SIMPLE-PG03: simultaneous requests share the last free proxy unit",async()=>{
        sql("insert into simple_mail.included values(true,'native-project',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',now()+interval '5 minutes',true,'fixture-hard-cap-proof',1,1)");
        const calls=[1,2].map(()=>sqlAsync("begin;set local role service_role;select simple_mail_included_reserve("+lit(randomUUID())+","+lit(simpleView.account_id)+",1,1,'native-project');commit;"));
        const values=await Promise.all(calls);assert.equal(values.filter(v=>v.trim()==='t').length,1);assert.equal(values.filter(v=>v.trim()==='f').length,1);
      });
      await check("SIMPLE-PG04: ACLs and used-reversal protection preserve all receipts",()=>{
        assert.equal(value("select bool_and(relrowsecurity) from pg_class where relnamespace='simple_mail'::regnamespace and relkind='r'"),true);
        for(const role of ['anon','authenticated','service_role'])assert.equal(value("select has_table_privilege("+lit(role)+",'simple_mail.onboarding','select')"),false);
        assert.equal(value("select has_function_privilege('authenticated','public.simple_mail_direct_saved(uuid,uuid,text,text)','execute')"),false);
        assert.throws(()=>sql(simpleRollback),/SIMPLE_RECEIPTS_MUST_BE_PRESERVED/);
        assert.equal(value("select count(*)::int from simple_mail.onboarding"),1);
      });
      assert.equal(results.length,attempted,"Every new native check must pass");
      await check("SIMPLE-PG05: concurrent callbacks admit a single token exchange",async()=>{
        const r=JSON.parse(humanSql("public.simple_mail_begin("+json({email:"native.race@example.test",provider:"gmail_oauth",advisor_id:fixture.seller,idempotency_key:randomUUID()})+","+lit(connectDigest(randomUUID()))+",'fixture-state','fixture','example.test')"));
        const auth="set local role authenticated;set local request.jwt.claims="+lit(JSON.stringify(claims()))+";";
        const values=await Promise.all([1,2].map(()=>sqlAsync("begin;"+auth+"select simple_mail_exchange_begin("+lit(r.id)+");commit;")));
        assert.equal(values.filter(v=>v.trim()==='t').length,1);assert.equal(values.filter(v=>v.trim()==='f').length,1);
      });
      await check("SIMPLE-PG06: initial-page CAS across two connections and atomic successful sync checkpoint",async()=>{
        const review=JSON.parse(humanSql("public.mail_transport_review("+lit(simpleView.account_id)+")"));
        humanSql("public.mail_transport_command("+lit(simpleView.account_id)+",'bootstrap_direct',"+json({...review.expected,target_provider:'gmail_oauth'})+","+lit(randomUUID())+")");
        const proof=connectDigest(randomUUID());const cycle=JSON.parse(serviceSql("public.mail_sync_begin("+lit(simpleView.account_id)+",1,"+lit(connectDigest(proof))+")"));
        serviceSql("public.simple_mail_initial_begin("+lit(cycle.id)+","+lit(proof)+",'101')");
        const attempts=await Promise.allSettled(['page-a','page-b'].map(page=>sqlAsync("begin;set local role service_role;select simple_mail_initial_advance("+lit(cycle.id)+","+lit(proof)+",null,"+lit(page)+");commit;")));
        assert.equal(attempts.filter(v=>v.status==='fulfilled').length,1);assert.equal(attempts.filter(v=>v.status==='rejected').length,1);
        const pending=JSON.parse(serviceSql("public.simple_mail_initial_begin("+lit(cycle.id)+","+lit(proof)+",'999')"));assert.equal(pending.baseline,'101');
        const readProof=connectDigest(randomUUID());const ticket=JSON.parse(serviceSql("public.mail_sync_acquire("+lit(cycle.id)+","+lit(proof)+",'profile','profile',"+lit(connectDigest(readProof))+")"));
        assert.equal(serviceSql("public.mail_transport_validate_context("+lit(ticket.id)+","+lit(readProof)+",null,0,true)").trim(),'t');
        serviceSql("public.mail_transport_finish("+lit(ticket.id)+","+lit(readProof)+",'finished')");
        serviceSql("public.simple_mail_initial_advance("+lit(cycle.id)+","+lit(proof)+","+lit(pending.page)+",null)");
        assert.equal(value("select history_id from gmail_sync_state where account_id="+lit(simpleView.account_id)),101);
      });
      assert.equal(results.length,attempted,"Every native check must pass");
`;
const marker = '      writeFileSync(\n        join(runRoot, "result.json"),';
if (source.split(marker).length !== 2) throw Error("NATIVE_INSERTION_DRIFT");
source = source
  .replace(marker, insertion + marker)
  .replace(
    "operationsPreserved: operations() === beforeOperations,",
    "legacyChecksPassedBeforeSimpleMail: legacyChecksPassed, simpleMailNativeChecks: results.length - legacyChecksPassed,",
  );
source = source.replace(
  ".filter((n) => /^\\d{3}_.*\\.sql$/.test(n))",
  ".filter((n) => /^\\d{3}_.*\\.sql$/.test(n) && Number(n.slice(0,3))<=47)",
);
source = source.replaceAll(
  '"../src/',
  JSON.stringify(pathToFileURL(path.resolve("src") + path.sep).href).slice(
    0,
    -1,
  ),
);
const dir = path.resolve(".local/simple-mail-native");
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, "derived-native.ts");
fs.writeFileSync(target, source);
const pg = path.resolve("../toolchains/postgresql-15.19/pgsql/bin");
if (!fs.existsSync(path.join(pg, "postgres.exe")))
  throw Error("LOCAL_POSTGRES_UNAVAILABLE");
const log = fs.openSync(
  "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/native-tests.txt",
  "w",
);
const env = {
  NODE_ENV: "test",
  SystemRoot: process.env.SystemRoot,
  COMSPEC: process.env.COMSPEC,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  PATH: process.env.PATH,
  PIPELINE_OS_CONNECT_V2_NATIVE: "1",
  PIPELINE_OS_CONNECT_PG_BIN: pg,
};
const child = spawn(
  process.execPath,
  [
    "--import",
    pathToFileURL(path.resolve("tests/offline.mjs")).href,
    "--import",
    import.meta.resolve("tsx"),
    "--test",
    target,
  ],
  { env, windowsHide: true, stdio: ["ignore", log, log] },
);
child.on("exit", (code) => {
  fs.closeSync(log);
  console.log(
    JSON.stringify({
      nativeExit: code,
      realProviderCalls: 0,
      log: "docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/native-tests.txt",
    }),
  );
  process.exitCode = code ?? 1;
});
