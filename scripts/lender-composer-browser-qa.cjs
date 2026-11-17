// Actual React components; all API responses and mail actions are fictional.
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { createRequire } = require("node:module");
const repo = path.resolve(__dirname, "..").replaceAll("\\", "/"),
  req = createRequire(repo + "/package.json");
const esbuild = createRequire(req.resolve("tsx"))("esbuild");
const out =
  process.env.LENDER_QA_OUTPUT ||
  fs.mkdtempSync(path.join(os.tmpdir(), "lender-browser-qa-"));
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {MailEditor} from '${repo}/src/components/mail-editor';
import {LenderTemplateLibrary} from '${repo}/src/components/lender-templates';
import {renderLenderMessage,lenderTemplateValues} from '${repo}/src/lib/lender-templates';
import {demoWorkspace} from '${repo}/src/lib/demo';import '${repo}/src/app/globals.css';
const id=()=>crypto.randomUUID(),data=demoWorkspace(),caseId=id(),account=id(),brand=id(),processId=id();
data.demo=false;data.profile={id:id(),name:'Agente ficticio QA',email:'agent@example.test',role:'superadmin',active:true};
const opportunity={...data.opportunities[0],id:caseId,company:'Norte Design Group · expediente ficticio',contact:'Alex Example',email:'alex@example.test',phone:'+1 555 0100',industry:'Design services',product:'Business loan',amount:75000,seller_id:data.profile.id,closer_id:null,primary_account_id:account};
data.opportunities=[opportunity];data.accounts=[{id:account,email:'agent@example.test',organization:'Curated QA',owner_id:data.profile.id,status:'connected',live_enabled:false,brand_context:{brand_id:brand,brand_revision:1,account_revision:1,account_id:account,brand_name:'Curated · QA ficticio',brand_code:'qa',can_campaign:true}}];data.sender_account_ids=[account];data.gmail_history_enabled=true;data.documents=[];data.gmail_files=[];data.activities=[];data.submissions=[];data.email_templates=[];
data.lenders=Array.from({length:73},(_,i)=>({id:id(),name:i===72?'Lender sin contacto · necesita revisión':'Lender ficticio '+String(i+1).padStart(2,'0'),email:i===72?'':'lender'+i+'@example.test',products:['MCA'],channel:'email',notes:''}));
data.lender_contacts=data.lenders.filter(l=>l.email).flatMap(l=>[{lender_id:l.id,email:l.email},{lender_id:l.id,email:'copy-'+l.email}]);
let templates=[{id:id(),name:'Presentación de financiación',subject:'Funding application — {{company}}',body:'Hello {{lender_name}},\\n\\nPlease review the funding application for **{{company}}**.\\n\\n- Requested amount: {{amount}}\\n- Industry: {{industry}}\\n- Contact: {{name}}\\n\\nThe selected documents are attached. Thank you.',body_format:'markdown',version:1,archived_at:null,updated_at:new Date().toISOString()}];
const campaigns=[{id:id(),name:'Campaña existente · revisar enlaces',subject:'Hello {{company}}',body:'Hi {{name}} — {{unsubscribe_url}}',body_format:'plain',version:1}];
const params=new URLSearchParams(location.search);let requestCount=0,previewCount=0,queued=0;
const response=(p,status=200)=>new Response(JSON.stringify(p),{status,headers:{'Content-Type':'application/json'}});
function counters(){document.getElementById('qa-counters').textContent='QA: '+requestCount+' consultas · '+previewCount+' revisiones · '+queued+' correos simulados · 0 envíos reales';}
window.fetch=async(input,opts={})=>{const url=new URL(String(input),location.href);if(url.origin!==location.origin)throw Error('QA_EXTERNAL_BLOCKED');requestCount++;counters();
if(url.pathname==='/api/mail/templates'){
 if(params.has('loading'))await new Promise(r=>setTimeout(r,2500));
 if(params.has('error'))return response({error:'Error ficticio de conexión. Reintenta la lectura.'},503);
 if(opts.method==='POST'){const p=JSON.parse(opts.body),existing=templates.find(t=>t.id===p.id);if(existing&&existing.version!==p.expected_version)return response({error:'Conflicto ficticio de versión'},409);const t={...p,version:(existing?.version||0)+1,archived_at:p.archived?new Date().toISOString():null,updated_at:new Date().toISOString()};templates=[...templates.filter(x=>x.id!==p.id),t];return response({template:t});}
 return response({templates:params.has('empty')?[]:templates.filter(t=>!t.archived_at),campaigns:params.has('empty')?[]:campaigns});
}
if(url.pathname==='/api/mail/recipient-selections')return response({selections:[],directory:{lenders:data.lenders,contacts:data.lender_contacts}});
if(url.pathname==='/api/conversations/channels')return response({processes:[{id:processId,label:'Operación actual · QA'}],submissions:[]});
if(url.pathname==='/api/mail'&&url.searchParams.has('signature'))return response({html:'<b>Agente ficticio QA</b><br>Curated · example.test',name:'Agente ficticio QA'});
if(url.pathname==='/api/mail/lender-preview'){previewCount++;const p=JSON.parse(opts.body);const messages=p.targets.map(t=>({...renderLenderMessage(p,lenderTemplateValues(opportunity,data.lenders.find(l=>l.id===t.lender_id).name)),...t,lender_name:data.lenders.find(l=>l.id===t.lender_id).name}));counters();return response({digest:'a'.repeat(64),messages,signature:{html:'<b>Agente ficticio QA</b><br>Curated · example.test',name:'Agente ficticio QA'}});}
if(url.pathname==='/api/mail'&&opts.method==='POST')return response({id:id()});
throw Error('QA_UNEXPECTED_ENDPOINT '+url.pathname);};
function App(){const[open,setOpen]=useState(true),[library,setLibrary]=useState(false);return <><div style={{padding:24}}><h1>Pipeline OS · QA ficticia</h1><p>Sin acceso a producción ni proveedores.</p><button className="button" onClick={()=>setOpen(true)}>Abrir nuevo correo</button> <button className="button" onClick={()=>setLibrary(v=>!v)}>Biblioteca Pipeline OS</button><p id="qa-counters">QA: 0 envíos reales</p>{library&&<LenderTemplateLibrary data={data} locale="es"/>}</div>{open&&<MailEditor data={data} opportunity={opportunity} locale="es" busy={false} start={{mode:'lenders',process_id:processId,subject:'',body:''}} close={()=>setOpen(false)} act={async(kind,p)=>{if(kind!=='mail_send')throw Error('QA_UNEXPECTED_ACTION');queued+=p.targets.length;counters();return 'simulated';}}/>}</>;}
createRoot(document.getElementById('root')).render(<App/>);
`;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: repo,
      loader: "tsx",
      sourcefile: "lender-browser-qa.tsx",
    },
    outfile: path.join(out, "browser.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    nodePaths: [repo + "/node_modules"],
    tsconfig: repo + "/tsconfig.json",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
    logLevel: "silent",
  });
  if (process.argv.includes("--build-only")) return;
  const server = http.createServer((request, response) => {
    const file = request.url.split("?")[0];
    if (file === "/" || file === "/index.html") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Curated · editor QA ficticio</title><link rel="stylesheet" href="/browser.css"><div id="root"></div><script src="/browser.js"></script></html>',
      );
      return;
    }
    if (["/browser.js", "/browser.css"].includes(file)) {
      response.writeHead(200, {
        "Content-Type": file.endsWith(".css")
          ? "text/css"
          : "application/javascript",
      });
      response.end(fs.readFileSync(path.join(out, file.slice(1))));
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  server.listen(3282, "127.0.0.1", () =>
    console.log("Fictional QA only: http://127.0.0.1:3282"),
  );
  process.on("SIGINT", () => server.close(() => process.exit()));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
