import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const folder=new URL('./',import.meta.url);
try{
 const sql=await readFile(new URL('selected-metadata.sql',folder),'utf8');
 if(!sql.startsWith('begin read only;')||!sql.trimEnd().endsWith('rollback;'))throw Error('READ_ONLY_GUARD');
 const origin=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'');
 if(origin.protocol!=='https:'||origin.hostname!=='supabase.finlabinc.com'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!['','8000'].includes(origin.port))throw Error('TARGET_MISMATCH');
 origin.port='';const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('CREDENTIAL_UNAVAILABLE');
 const response=await fetch(new URL('/pg/query',origin),{method:'POST',redirect:'error',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(15000)});
 const rows=await response.json().catch(()=>null);const data=Array.isArray(rows)?rows.find(r=>r.selected_metadata)?.selected_metadata:null;
 if(!response.ok||data?.database!=='postgres'||data.read_only!=='on')throw Error('READ_ONLY_QUERY_UNPROVEN');
 await writeFile(new URL('selected-metadata.json',folder),JSON.stringify({at:new Date().toISOString(),apiOrigin:origin.origin,sqlSha256:createHash('sha256').update(sql).digest('hex'),requests:1,remoteChanges:0,...data},null,2)+'\n');
 console.log(JSON.stringify(data));
}catch(error){console.log(JSON.stringify({error:/^(READ_ONLY_GUARD|TARGET_MISMATCH|CREDENTIAL_UNAVAILABLE|READ_ONLY_QUERY_UNPROVEN)$/.test(error?.message)?error.message:'REDACTED',remoteChanges:0}));process.exitCode=1;}
