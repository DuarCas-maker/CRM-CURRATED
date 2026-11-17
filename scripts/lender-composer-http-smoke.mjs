// Read-only anonymous deployment probes. POSTs stop at origin/auth; no mailbox.
import { mkdir, writeFile } from "node:fs/promises";
const root="https://crm.finlabinc.com";
const directory="docs/specs/lender-composer-20261116/publication";
const probes=[
  ["health","/api/health","GET",null,200],
  ["templates_session","/api/mail/templates","GET",null,401],
  ["template_save_session","/api/mail/templates","POST",root,401],
  ["template_save_origin","/api/mail/templates","POST","https://example.invalid",403],
  ["lender_preview_session","/api/mail/lender-preview","POST",root,401],
  ["lender_preview_origin","/api/mail/lender-preview","POST","https://example.invalid",403],
];
const checks=[];
for(const[name,path,method,origin,expected]of probes){
  const response=await fetch(root+path,{method,headers:{...(origin?{Origin:origin}:{}),...(method==="POST"?{"Content-Type":"application/json"}:{})},...(method==="POST"?{body:"{}"}:{}),redirect:"manual",signal:AbortSignal.timeout(15000)});
  const cache=response.headers.get("Cache-Control")||"";
  const body=await response.json().catch(()=>null);
  checks.push({name,path,method,status:response.status,expected,noStore:cache.includes("no-store"),knownHealth:name!=="health"||body?.status==="ok"&&body?.service==="curated-crm",pass:response.status===expected&&cache.includes("no-store")&&(name!=="health"||body?.status==="ok"&&body?.service==="curated-crm")});
}
const report={at:new Date().toISOString(),origin:root,anonymous:true,noBusinessWrites:true,noProviderCalls:true,checks,passed:checks.every(c=>c.pass)};
await mkdir(directory,{recursive:true});
await writeFile(directory+"/public-smoke.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report));
process.exitCode=report.passed?0:1;
