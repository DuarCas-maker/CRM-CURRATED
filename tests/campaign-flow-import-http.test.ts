import test,{mock} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
if(!process.execArgv.includes('--experimental-test-module-mocks'))test('CF import HTTP: actual multipart route registers one atomic bounded consent',()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;const result=execFileSync(process.execPath,['--import','./tests/offline.mjs','--import','tsx','--experimental-test-module-mocks','--test','tests/campaign-flow-import-http.test.ts'],{env,encoding:'utf8',windowsHide:true,timeout:30000});assert.match(result,/# fail 0/);
});
else test('CF import HTTP: counts must match the parsed file, provider configuration and authenticated actor',async()=>{
 const real=await import('../src/lib/server/supabase');const actor=randomUUID(),key=randomUUID(),id=randomUUID();let prior:any=null,uploads=0;const commands:any[]=[];
 const env={APP_ORIGIN:process.env.APP_ORIGIN,BOUNCER_API_KEY:process.env.BOUNCER_API_KEY};process.env.APP_ORIGIN='https://crm.example.test';process.env.BOUNCER_API_KEY='fixture-no-provider';
 const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:prior,error:null})};
 const service={from:()=>query,storage:{from:()=>({upload:async()=>{uploads++;return {error:null};}})},rpc:async()=>{throw Error('Legacy registration must not run in verify mode');}};
 const session=mock.module('../src/lib/server/supabase.ts',{namedExports:{...real,requireUser:async()=>({profile:{id:actor,role:'superadmin'},db:{rpc:async(name:string,args:any)=>{commands.push({name,args});return {data:id,error:null};}}}),serviceClient:()=>service}});
 const parser=mock.module('../src/lib/server/parse-import.ts',{namedExports:{parseImport:async()=>({headers:['Email'],sheet:'Sheet1',total:3})}});
 try{
  const route=await import('../src/app/api/import/route');
  const post=(max:string)=>{const body=new FormData();body.set('file',new File(['Email\na@example.test\nb@example.test\nc@example.test'],'Fixture.csv'));body.set('mapping',JSON.stringify({email:'Email',contact:'',company:'',phone:'',industry:''}));body.set('idempotency_key',key);body.set('verify_max',max);return route.POST(new Request('https://crm.example.test/api/import',{method:'POST',headers:{origin:'https://crm.example.test'},body}));};
  assert.equal((await post('2')).status,409);assert.equal(uploads,0);assert.equal(commands.length,0);
  const r=await post('3');assert.equal(r.status,202);assert.equal((await r.json()).id,id);assert.equal(commands[0].name,'campaign_flow_register_import');assert.equal(commands[0].args.p.max_count,3);assert.equal(commands[0].args.p.storage_path,`${actor}/${key}.csv`);
  prior={id};assert.equal((await post('3')).status,202);assert.equal(commands.length,2);
  delete process.env.BOUNCER_API_KEY;assert.equal((await post('3')).status,503);assert.equal(commands.length,2);
 }finally{parser.restore();session.restore();for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
