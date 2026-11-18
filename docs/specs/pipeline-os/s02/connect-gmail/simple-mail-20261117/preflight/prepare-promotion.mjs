import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const feature='docs/specs/pipeline-os/s02/connect-gmail/simple-mail-20261117/';
const target=path.resolve('../simple-mail-promotion-20261118');
const base='b86148613648076e47fbcc51db60895de331623f';
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
const source=process.cwd();const manifest=JSON.parse(fs.readFileSync(feature+'implementation-manifest.json','utf8'));
const upstream=new Set(git(source,'diff','--name-only',manifest.sourceCommit,base).split(/\r?\n/));
if(manifest.files.some(f=>upstream.has(f.path)))throw Error('PROMOTION_SOURCE_OVERLAP');
if(!fs.existsSync(target))git(source,'worktree','add','-b','codex/simple-mail-promotion-20261118',target,base);
if(git(target,'rev-parse','HEAD')!==base||git(target,'branch','--show-current')!=='codex/simple-mail-promotion-20261118')throw Error('PROMOTION_TARGET_IDENTITY_MISMATCH');
const allowed=new Set(manifest.files.map(f=>f.path));
const status=execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:target,encoding:'utf8',windowsHide:true});
for(const line of status.split(/\r?\n/).filter(Boolean)){
 const p=line.slice(3);if(!allowed.has(p)||!fs.readFileSync(path.resolve(target,p)).equals(fs.readFileSync(path.resolve(p))))throw Error('PROMOTION_TARGET_UNOWNED_CHANGE');
}
for(const file of manifest.files){const dest=path.resolve(target,file.path);if(!dest.startsWith(target+path.sep)||file.path.split(/[\\/]/).some(s=>s==='.local'||s==='.env'))throw Error('PUBLIC_PATH_REQUIRED');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.resolve(file.path),dest);}
fs.cpSync(path.resolve(feature),path.resolve(target,feature),{recursive:true,filter:(p)=>!fs.lstatSync(p).isSymbolicLink()});
const report={at:new Date().toISOString(),branch:'codex/simple-mail-promotion-20261118',baseCommit:base,originalImplementationBase:manifest.sourceCommit,sharedOverlap:[],copiedPublicFiles:manifest.files.map(f=>({path:f.path,sha256:createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')})),remoteChanges:0,committed:false,pushed:false};
for(const root of [source,target])fs.writeFileSync(path.resolve(root,feature,'preflight/promotion-base.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({target,branch:report.branch,baseCommit:base,files:manifest.files.length,remoteChanges:0}));
