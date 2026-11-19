import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const folder =
  "docs/specs/pipeline-os/s02/connect-gmail/gmail-onboarding-errors-20261118/";
const moduleUrl = pathToFileURL(
  path.resolve("src/lib/server/mail-accounts/onboarding/legacy-account.ts"),
).href;
let runner = fs.readFileSync("scripts/run-simple-mail-native.mjs", "utf8");
const extra = `
      const {prepareLegacyMailbox,legacyMailboxPorts}=await import(${JSON.stringify(moduleUrl)});
      const legacyClient={rpc:async(name:string,p:any)=>{
        try{
          let expression:string;
          if(name==='brand_management_page')expression='public.brand_management_page('+lit(p.collection)+','+lit(p.cursor)+','+p.page_size+')';
          else if(name==='crm_command')expression='public.crm_command('+lit(p.kind)+','+json(p.p)+','+lit(p.request_key)+')';
          else throw Error('NATIVE_RPC_NOT_ALLOWED');
          return {data:JSON.parse(humanSql(expression)),error:null};
        }catch(e:any){return {data:null,error:{message:String(e.stderr||e.message).match(/BRAND_[A-Z_]+/)?.[0]||'BRAND_UNAVAILABLE'}};}
      }};
      const legacyPorts=legacyMailboxPorts(legacyClient as any);
      for(const pending of [false,true])await check('LEGACY-PG: preserve unbranded account, '+(pending?'reuse pending review':'create audited review'),async()=>{
        const email='native.legacy.'+pending+'@example.test';
        sql("insert into public.mail_accounts(email,organization,status,live_enabled) values("+lit(email)+",'fixture','disconnected',false)");
        const account=value('select id from mail_accounts where email='+lit(email));
        const revision=value('select brand_revision from mail_accounts where id='+lit(account));
        const brand=value("select id from operating_brands where code='CURATED_FINANCIAL'");
        if(pending)humanSql("public.crm_command('brand_mapping_propose',"+json({account_id:account,proposed_brand_id:brand,expected_account_revision:revision,evidence_reference:'native-compatible-review',history_approved:false})+','+lit(randomUUID())+')');
        const input={email,provider:'gmail_oauth' as const,advisor_id:fixture.seller,idempotency_key:randomUUID()};
        const call='public.simple_mail_begin('+json(input)+','+lit(connectDigest(randomUUID()))+",'fixture-encrypted-state','fixture','example.test')";
        assert.throws(()=>humanSql(call),/BRAND_REVIEW_REQUIRED/);
        await prepareLegacyMailbox(legacyPorts,input,'fixture');
        const started=JSON.parse(humanSql(call));assert.equal(started.account_id,account);assert.equal(started.state,'prepared');
        await prepareLegacyMailbox(legacyPorts,input,'fixture');
        assert.equal(value("select count(*)::int from audit_log where action='brand_mapping_confirm' and entity_id in(select id from mail_account_brand_reviews where account_id="+lit(account)+')'),1);
        assert.equal(value('select count(*)::int from mail_credentials where account_id='+lit(account)),0);
        assert.equal(value('select count(*)::int from mail_permissions where account_id='+lit(account)),0);
        assert.equal(value('select count(*)::int from outbox where account_id='+lit(account)),0);
      });
      await check('LEGACY-PG: MFA denies automatic confirmation and preserves the account',async()=>{
        const email='native.legacy.mfa@example.test';
        sql("insert into public.mail_accounts(email,organization,status,live_enabled) values("+lit(email)+",'fixture','disconnected',false)");
        session.aal='aal1';
        try{await assert.rejects(prepareLegacyMailbox(legacyPorts,{email,provider:'gmail_oauth',idempotency_key:randomUUID()},'fixture'),/SIMPLE_FORBIDDEN/);}
        finally{session.aal='aal2';}
        assert.equal(value('select operating_brand_id is null from mail_accounts where email='+lit(email)),true);
      });
`;
const marker = "\n`;\nconst marker";
if (!runner.includes(marker)) throw Error("NATIVE_RUNNER_DRIFT");
// Escape for the runner's template literal; generated SQL uses synthetic data only.
runner = runner.replace(
  marker,
  extra
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${") + marker,
);
runner = runner.replaceAll(
  '".local/simple-mail-native"',
  '".local/legacy-mail-native"',
);
runner = runner.replaceAll(
  '"docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/native-tests.txt"',
  JSON.stringify(folder + "native-tests.txt"),
);
const directory = path.resolve(".local/legacy-mail-native");
fs.mkdirSync(directory, { recursive: true });
const target = path.join(directory, "runner.mjs");
fs.writeFileSync(target, runner);
await import(pathToFileURL(target).href);
