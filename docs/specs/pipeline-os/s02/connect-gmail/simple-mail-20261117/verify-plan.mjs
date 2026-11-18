import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Offline documentary verification only. No credentials, provider calls or DB.
const folder = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(folder, '../../../../../..');
const base = '9d28d5a257ef26c618d1884f4dc90eb7c0701530';
const names = ['spec.md','design.md','acceptance.md','tasks.md','adr-001.md','rollout.md','verification.md'];
const documents = Object.fromEntries(await Promise.all(names.map(async name => [name,await readFile(path.join(folder,name),'utf8')])));
const manifest = JSON.parse(await readFile(path.join(folder,'implementation-manifest.json'),'utf8'));
const checks = [];
function check(name, value) { checks.push({name,passed:!!value}); }
check('all artifacts populated', names.every(name=>documents[name].length>500 && !documents[name].includes('{{')));
check('source commit pinned', manifest.sourceCommit===base);
check('local implementation does not imply publication', manifest.mode==='implementation-local' && manifest.productImplemented===true && manifest.remoteChanges===false);
check('migration ordinal not reserved', manifest.sql.ordinalReserved===false);
for(let n=1;n<=11;n++) {
 const id=String(n).padStart(3,'0');
 check('FR-'+id+' acceptance and design coverage', documents['spec.md'].includes('FR-'+id) && documents['spec.md'].includes('AC-'+id) && documents['acceptance.md'].includes('AC-'+id));
}
for(let n=1;n<=12;n++) check('decision '+n+' recorded', documents['spec.md'].includes('| '+n+' |'));
for(let n=1;n<=12;n++) check('task '+n+' recorded',documents['tasks.md'].includes('| T-'+String(n).padStart(3,'0')+' |'));
check('free usage required',documents['spec.md'].includes('cupo gratuito') && documents['design.md'].includes('consumo global'));
check('no delivery retry from uncertainty',documents['acceptance.md'].includes('sin otro POST') && documents['design.md'].includes('cancelled_before_wire'));
check('historical planning and current evidence separated',documents['verification.md'].includes('implementation-verification.md') && documents['rollout.md'].includes('No se ejecuta publicación'));

const files = [
 ...manifest.sharedPathsProposed.filter(name=>!name.endsWith('/')),
 'src/lib/server/mail-transport/gmail-direct.ts',
 'src/lib/server/mail-transport/composio-proxy.ts',
 'src/lib/server/mail-accounts/composio-connect/recovery.ts',
 'src/lib/server/mail-accounts/composio-connect/orchestrator.ts',
 'src/app/api/mail/composio/connect/recovery/candidate/route.ts',
 'supabase/migrations/039_campaign_delivery_controls.sql',
 'package.json'
];
const sources=[];
for(const name of [...new Set(files)]) {
 if(name.split('/').some(segment=>segment==='.local'||segment==='.env')) throw Error('Private source rejected');
 const result=spawnSync('git',['show',base+':'+name],{cwd:root,maxBuffer:8*1024*1024});
 check('base source exists: '+name,result.status===0);
 if(result.status===0) sources.push({path:name,sha256:createHash('sha256').update(result.stdout).digest('hex'),bytes:result.stdout.length});
}
const at=new Date().toISOString();
await writeFile(path.join(folder,'discovery.json'),JSON.stringify({at,readOnlySourceInspection:true,baseCommit:base,source:'public git objects in shared repository',sources,providerCalls:0,productionMutations:0,credentialsRead:false},null,2)+'\n');
const report={at,kind:'documentary checks only',passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,checks,productTestsExecuted:false};
await writeFile(path.join(folder,'document-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed:report.failed,sources:sources.length,productTestsExecuted:false}));
if(report.failed) {console.log(JSON.stringify(checks.filter(c=>!c.passed)));process.exitCode=1;}
