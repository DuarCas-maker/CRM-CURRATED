import { writeFile } from 'node:fs/promises';
const target='https://crm.finlabinc.com';
const checks=await Promise.all([
  ['/api/health',200],['/login',200],['/api/workspace',401],
  ['/api/pipeline-os',401],['/api/pipeline-os/master',401],['/api/pipeline-os/tasks',401],
].map(async([path,expected])=>{
  const started=performance.now();
  const response=await fetch(new URL(path,target),{redirect:'error',signal:AbortSignal.timeout(15000)});
  const cache=response.headers.get('cache-control');
  await response.body?.cancel();
  if(response.status!==expected || (expected===401 && !cache?.includes('no-store')))throw new Error('PUBLIC_SMOKE_FAILED_'+path+'_'+response.status);
  return {path,status:response.status,observed_ms:Math.round(performance.now()-started),cache_control:cache};
}));
const report={at:new Date().toISOString(),target,authenticated:false,checks,client_rows_saved:false};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
