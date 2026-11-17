// Inert local harness; not imported by application routes.
import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import type {Workspace} from '../../src/lib/domain';import type {EmailTemplate} from '../../src/lib/campaign-templates';
import {CampaignControlPanel} from '../../src/components/pipeline-os/campaign-control-panel';import {CampaignImportFlow} from '../../src/components/pipeline-os/campaign-import-flow';
import {useLeaveConfirmation} from '../../src/components/unsaved-changes';import '../../src/app/globals.css';import '../../src/components/pipeline-os/workspace.css';
function Fixture(){const [data,setData]=useState<Workspace|null>(null),[theme,setTheme]=useState('light'),[build,setBuild]=useState(false),[template,setTemplate]=useState<EmailTemplate|null>(null),[revision,setRevision]=useState(0);const {requestLeave,confirmation}=useLeaveConfirmation('es');
 const refresh=async()=>{const r=await fetch('/qa/workspace');if(!r.ok)throw Error('Fixture workspace failed');setData(await r.json());setRevision(n=>n+1);};useEffect(()=>{void refresh();},[]);
 return <main className="pipeline-os" data-pos-theme={theme} style={{padding:24}}><div style={{maxWidth:1200,margin:'0 auto'}}>
  <div className="pos-info" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,gap:16}}><strong>ENSAYO LOCAL · DATOS FICTICIOS · SIN PROVEEDORES</strong><button className="pos-btn" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>Cambiar tema</button></div>
  {!data?<p role="status">Cargando datos ficticios…</p>:build?<CampaignImportFlow data={data} locale="es" initialTemplate={template} refresh={refresh} act={async()=>{throw Error('Fixture: legacy mutations disabled');}} close={()=>requestLeave(()=>setBuild(false))}/>:<CampaignControlPanel key={revision} data={data} locale="es" act={async()=>{throw Error('Fixture: legacy mutations disabled');}} changed={refresh} create={t=>{setTemplate(t||null);setBuild(true);}} openConversation={()=>{}}/>}
 </div>{confirmation}</main>;
}createRoot(document.getElementById('root')!).render(<Fixture/>);
