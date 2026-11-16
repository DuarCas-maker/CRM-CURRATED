import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {pathToFileURL} from "node:url";
const directory="docs/specs/pipeline-os/s02/connect-gmail/reconcile-20261116/";
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,
 PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,APP_ORIGIN:"https://crm.example.test",
 NEXT_PUBLIC_SUPABASE_URL:"https://supabase.invalid",NEXT_PUBLIC_SUPABASE_ANON_KEY:"fixture-public-key",DEMO_ENABLED:"false",
 COMPOSIO_CONNECT_ENABLED:"false",NEXT_TELEMETRY_DISABLED:"1",NODE_OPTIONS:"--import "+pathToFileURL(path.resolve("tests/offline.mjs")).href};
const run=(name,args)=>new Promise(resolve=>{
 const out=fs.openSync(directory+name+".txt","w");const child=spawn(process.execPath,args,{env,windowsHide:true,stdio:["ignore",out,out]});
 child.on("exit",code=>{fs.closeSync(out);console.log(JSON.stringify({check:name,exit:code}));resolve({check:name,exit:code});});
 child.on("error",()=>{fs.closeSync(out);resolve({check:name,exit:1});});
});
const suites=["connect-provider","connect-recovery","connect-http-ui","connect-http","connect-http-session","connect-v2","connect-store-composition","connect-setup","quota-connect","connect-contract","connect-composition","connect-reconcile"];
const [tests,types]=await Promise.all([
 run("regression",["--import",import.meta.resolve("tsx"),"--test","--test-concurrency=2",...suites.map(n=>"tests/pipeline-os-s02-"+n+".test.ts")]),
 run("types",["../../../node_modules/next/dist/bin/next","typegen"]).then(async r=>r.exit===0?run("typecheck",["../../../node_modules/typescript/bin/tsc","--noEmit"]):r),
]);
if(tests.exit!==0||types.exit!==0) {process.exitCode=1;}else{
 const build=await run("build-webpack",["../../../node_modules/next/dist/bin/next","build","--webpack"]);
 fs.writeFileSync(directory+"local-checks.json",JSON.stringify({at:new Date().toISOString(),checks:[tests,types,build],realCredentials:false,externalFetchGuard:true},null,2)+"\n");
 process.exitCode=build.exit===0?0:1;
}
