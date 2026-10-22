import * as vscode from 'vscode';
import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {mechanismPreview,assertPreviewFresh} from '../../../lib/mechanism-preview.js';
import {MechanismSession} from '../../../lib/mechanism-session.js';
export function mechanismPanels(context,{workspace,ensureRuntime}){
 const panels=new Map();
 async function open(resource,options={}){
  const root=workspace(resource),descriptor=await mechanismPreview(root,options);
  panels.get(root)?.panel.dispose();
  const media=path.join(context.extensionPath,'media'),panel=vscode.window.createWebviewPanel('cadcove.mechanism','Mechanism preview',vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[media,path.dirname(descriptor.binary),...(descriptor.field?[descriptor.field]:[])].map(vscode.Uri.file)});
  let resolve,reject;const ready=new Promise((a,b)=>{resolve=a;reject=b;});
  const state={panel,descriptor,pending:new Map(),ready,mode:'cad',diagnostics:{phase:'loading'},closed:false};panels.set(root,state);
  const timer=setTimeout(()=>reject(Error('Mechanism preview loading timed out')),120000);
  const listener=panel.webview.onDidReceiveMessage(message=>{
   if(message.report){state.diagnostics=message.report;if(message.report.phase==='ready'){clearTimeout(timer);resolve({ok:true,...message.report});}else if(message.report.phase==='error'){clearTimeout(timer);reject(Error(message.report.error));}}
   if(message.reply){const p=state.pending.get(message.reply);if(p){clearTimeout(p.timer);state.pending.delete(message.reply);message.error?p.reject(Error(message.error)):p.resolve(message.result);}}
  });
  panel.onDidDispose(()=>{state.closed=true;clearTimeout(timer);reject(Error('Mechanism preview closed'));state.physics?.close();listener.dispose();for(const p of state.pending.values()){clearTimeout(p.timer);p.reject(Error('Mechanism preview closed'));}panels.delete(root);});
  const uri=p=>panel.webview.asWebviewUri(vscode.Uri.file(p)).toString(),nonce=randomBytes(20).toString('hex');
  const config={sourceRevision:descriptor.sourceRevision,mesh:uri(descriptor.binary),meshHash:descriptor.meshHash,definition:descriptor.definition,field:descriptor.field?uri(descriptor.field):null};
  panel.webview.html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${panel.webview.cspSource}; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#121820}canvas{width:100%;height:100%;display:block;touch-action:none}#selection{position:absolute;top:8px;left:12px;max-width:80%;padding:6px 9px;background:#222c;color:#ffd440;font:12px sans-serif;pointer-events:none}#status{position:absolute;bottom:8px;left:12px;color:#ddd;font:12px sans-serif;pointer-events:none}</style></head><body><canvas tabindex="0"></canvas><div id="selection" hidden></div><div id="status">Loading cached CAD…</div><script nonce="${nonce}">window.cadcoveMechanism=${JSON.stringify(config).replace(/</g,'\\u003c')}</script><script nonce="${nonce}" src="${uri(path.join(media,'mechanism.js'))}"></script></body></html>`;
  return ready;
 }
 function view(state,method,args={}){return new Promise((resolve,reject)=>{
  if(state.closed)return reject(Error('Mechanism preview closed'));
  const id=randomUUID(),timer=setTimeout(()=>{state.pending.delete(id);reject(Error('Mechanism preview did not respond'));},30000);state.pending.set(id,{resolve,reject,timer});void state.panel.webview.postMessage({request:id,method,args});
 });}
 async function request(resource,action,args={}){
  if(action==='command'&&['physics','motors','zero','cad'].includes(args.method)){action=args.method;args=args.args??{};}
  const root=workspace(resource),s=panels.get(root);if(!s)throw Error('Open mechanism preview first');await s.ready;
  if(s.busy)throw Error('Mechanism preview request already in flight');s.busy=true;
  try{
   const method=action==='command'?args.method:action;
   if(!['state','capabilities','capture','view','selection','opacity','visibility','highlight','reveal','zero','cad'].includes(method))await assertPreviewFresh(s.descriptor);
   if(action==='physics'){
    if(s.physics)throw Error('Physics is already active');
    const executable=await ensureRuntime();if(s.closed)throw Error('Preview closed');
    const native=path.join(path.dirname(executable),process.platform==='win32'?'instantcad-sim.exe':'instantcad-sim');
    const session=new MechanismSession(native,{onState:state=>{if(!s.closed)void s.panel.webview.postMessage({physics:state});},onError:e=>{s.diagnostics={phase:'error',error:e.message};}});
    try{
     const pose=await view(s,'motion',{action:'stop'});
     const state=await session.start(s.descriptor.definition,s.descriptor.parts,pose.angles);
     await assertPreviewFresh(s.descriptor);
     await view(s,'physics');s.physics=session;s.mode='physics';await s.panel.webview.postMessage({physics:state});return {ok:true,mode:'physics',world:session.compiled.world,scope:session.compiled.scope,initialAngles:pose.angles,initialVelocity:'rest',fieldContact:false};}catch(e){session.close();throw e;}
   }
   if(action==='motors'){if(!s.physics)throw Error('Start physics first');return s.physics.command(args);}
   if(action==='zero'){if(!s.physics)throw Error('Start physics first');return s.physics.zero();}
   if(action==='cad'){s.physics?.close();s.physics=null;s.mode='cad';return view(s,'cad');}
   if(method==='capture'){
    const frame=await view(s,action,args),file=path.join(path.dirname(s.descriptor.binary),'mechanism-preview.png');
    if(!frame.image?.startsWith('data:image/png;base64,'))throw Error('Invalid preview capture');await fs.writeFile(file,Buffer.from(frame.image.slice(22),'base64'));
    return {...frame,image:file,sourceRevision:s.descriptor.sourceRevision,mechanismHash:s.descriptor.mechanismHash};
   }
   return view(s,action,args);
  }finally{s.busy=false;}
 }
 return {open,request,canvases:root=>{const s=panels.get(root);return s?[{kind:'field',active:s.panel.active,visible:s.panel.visible}]:[];},closeAll(){for(const s of [...panels.values()])s.panel.dispose();}};
}
