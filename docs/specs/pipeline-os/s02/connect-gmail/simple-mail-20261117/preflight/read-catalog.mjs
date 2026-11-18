// Metadata-only production preflight. Credentials arrive through the existing
// connection runtime; no env content, provider keys, tokens or personal rows are returned.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const folder=new URL('./',import.meta.url);
const sql=await readFile(new URL('catalog.sql',folder),'utf8');
if(!sql.startsWith('begin read only;')||!sql.trimEnd().endsWith('rollback;')||/\b(insert|update|delete|create|alter|drop|copy|execute|do|grant|revoke|truncate)\s+(?:into|table|function|schema|role|public\.|mail_runtime\.)/i.test(sql))throw Error('READ_ONLY_QUERY_GUARD');
try{
 const origin=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'');
 if(origin.protocol!=='https:'||origin.hostname!=='supabase.finlabinc.com'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!['','8000'].includes(origin.port))throw Error('TARGET_MISMATCH');
 origin.port='';
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key||/[\r\n]/.test(key))throw Error('CONNECTION_CREDENTIAL_UNAVAILABLE');
 const response=await fetch(new URL('/pg/query',origin),{method:'POST',redirect:'error',headers:{apikey:key,'content-type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(20000)});
 const rows=await response.json().catch(()=>null);
 if(!response.ok||!Array.isArray(rows))throw Error('CATALOG_HTTP_'+response.status);
 const data=rows.find(r=>r.simple_mail_preflight)?.simple_mail_preflight;
 if(!data||data.database!=='postgres'||!['supabase_admin','postgres'].includes(data.role)||data.read_only!=='on'||!data.relations?.some(t=>t.schema==='public'&&t.name==='mail_accounts'))throw Error('CATALOG_TARGET_UNPROVEN');
 const report={at:new Date().toISOString(),apiOrigin:origin.origin,sqlSha256:createHash('sha256').update(sql).digest('hex'),readOnly:true,requests:1,remoteChanges:0,providerCalls:0,credentialsPrinted:false,...data};
 await writeFile(new URL('catalog.json',folder),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({readOnly:true,http:response.status,functions:data.functions.length,relations:data.relations.length,columns:data.columns.length,candidateGuard:data.candidate_guard,counts:data.counts,remoteChanges:0}));
}catch(error){const message=typeof error?.message==='string'&&/^(TARGET_MISMATCH|CONNECTION_CREDENTIAL_UNAVAILABLE|CATALOG_(HTTP_[0-9]+|TARGET_UNPROVEN))$/.test(error.message)?error.message:'PREFLIGHT_REDACTED_FAILURE';console.log(JSON.stringify({error:message,remoteChanges:0}));process.exitCode=1;}
