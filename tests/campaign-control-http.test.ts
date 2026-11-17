import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
if(!process.execArgv.includes('--experimental-test-module-mocks')){
 test('CC HTTP: actual route runs with isolated session fixtures',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const output=execFileSync(process.execPath,['--import','./tests/offline.mjs','--import','tsx','--experimental-test-module-mocks','--test','tests/campaign-control-http.test.ts'],{env,encoding:'utf8',windowsHide:true,timeout:30000});
  assert.match(output,/# fail 0/);
 });
}else test('CC HTTP: session/MFA, exact origin, bounded JSON and closed RPC failures',async()=>{
 const real=await import('../src/lib/server/supabase');
 let authStatus=401,role='superadmin',authCalls=0,rpcCalls=0,missing=false;
 const origin=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://crm.example.test';
 const session=mock.module('../src/lib/server/supabase.ts',{namedExports:{...real,requireUser:async()=>{
  authCalls++;if(authStatus)throw new real.HttpError(authStatus,'fixture session rejected');
  return {profile:{role},db:{rpc:async()=>{rpcCalls++;return missing?{data:null,error:{code:'PGRST202'}}:{data:{ok:true},error:null};}}};
 }}});
 try{
  const route=await import('../src/app/api/campaigns/control/route');const url='https://crm.example.test/api/campaigns/control';
  assert.equal((await route.GET(new Request(url))).status,401);
  authStatus=403;assert.equal((await route.GET(new Request(url))).status,403);
  authStatus=0;const read=await route.GET(new Request(url));assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
  const body={kind:'pause',payload:{id:randomUUID()},request_key:randomUUID()};
  const post=(from:string|null,text=JSON.stringify(body),contentType='application/json')=>route.POST(new Request(url,{method:'POST',headers:{...(from?{origin:from}:{}),'content-type':contentType},body:text}));
  const before=authCalls;
  assert.equal((await post('https://evil.example.test')).status,403);assert.equal((await post(null)).status,403);assert.equal(authCalls,before);
  assert.equal((await post('https://crm.example.test','{')).status,400);
  assert.equal((await post('https://crm.example.test',JSON.stringify(body),'text/plain')).status,400);
  assert.equal((await post('https://crm.example.test','x'.repeat(400001))).status,413);
  role='seller';const prior=rpcCalls;assert.equal((await post('https://crm.example.test')).status,403);assert.equal(rpcCalls,prior);
  role='superadmin';assert.equal((await post('https://crm.example.test')).status,200);
  missing=true;assert.equal((await route.GET(new Request(url))).status,503);
 }finally{session.restore();if(origin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=origin;}
});
