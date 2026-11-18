import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Copy only this feature's public payload into a fresh worktree. No reset/merge.
const source=process.cwd();
const feature='docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/';
const prior=JSON.parse(fs.readFileSync(feature+'preflight/promotion-base.json','utf8'));
const base='544b8352634d9b07bcb0918df5866f37420515fa';
const branch='codex/simple-mail-ready-20261118';
const target=path.resolve('../simple-mail-ready-20261118');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
if(git(source,'rev-parse','HEAD')!==prior.baseCommit)throw Error('SOURCE_BASE_DRIFT');
if(fs.existsSync(target))throw Error('FRESH_TARGET_REQUIRED');
const files=[...new Set([...prior.copiedPublicFiles.map(f=>f.path),'tests/gmail-attachments.test.ts'])];
const upstream=git(source,'diff','--name-only',prior.baseCommit,base).split(/\r?\n/).filter(Boolean);
const overlap=files.filter(p=>upstream.includes(p));
if(overlap.length)throw Error('SHARED_SOURCE_OVERLAP: '+overlap.join(','));
for(const f of prior.copiedPublicFiles){
 const actual=createHash('sha256').update(fs.readFileSync(f.path)).digest('hex');
 if(actual!==f.sha256)throw Error('UNEXPECTED_SOURCE_CHANGE: '+f.path);
}
for(const p of files)if(p.split(/[\\/]/).some(s=>s==='.local'||s==='.env'||s==='node_modules'))throw Error('PUBLIC_FILE_REQUIRED');
git(source,'worktree','add','-b',branch,target,base);
for(const p of files){const dest=path.resolve(target,p);if(!dest.startsWith(target+path.sep))throw Error('TARGET_ESCAPE');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.resolve(p),dest);}
fs.cpSync(path.resolve(feature),path.resolve(target,feature),{recursive:true,filter:p=>!fs.lstatSync(p).isSymbolicLink()});
const report={at:new Date().toISOString(),branch,baseCommit:base,originalImplementationBase:prior.originalImplementationBase,priorPromotionBase:prior.baseCommit,sharedOverlap:[],upstreamChangesReviewed:upstream,copiedPublicFiles:files.sort().map(p=>({path:p,sha256:createHash('sha256').update(fs.readFileSync(p)).digest('hex')})),additionalAuthorization:'Resolve attachment failure; one compatibility test updated with explicit owner/closer/outsider assertions; no policy changes',remoteChanges:0,committed:false,pushed:false};
fs.writeFileSync(path.join(target,feature,'preflight/promotion-base.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(feature+'preflight/promotion-refresh.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({target,base,branch,files:files.length,sharedOverlap:[]}));
