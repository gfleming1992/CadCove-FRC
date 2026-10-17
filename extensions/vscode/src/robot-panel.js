import * as vscode from 'vscode';
import path from 'node:path';
import fs from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';

// Imported CAD is independent of physics readiness and Java/vendor runtimes.
export function robotPanels(context,{workspace,simulationProject,cad,settings}){
 const panels=new Map();
 async function open(resource){
  const root=workspace(resource),configured=await settings(root);
  const source=path.join(root,configured.sourceDirectory,configured.entryPoint);
  const hasSource=await fs.access(source).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
  if(hasSource){panels.get(root)?.panel.dispose();await cad.openModel(vscode.Uri.file(source));return {ok:true,kind:source.endsWith('.py')?'cadquery':'javascript',source};}
  const file=await simulationProject(root),profile=JSON.parse(await fs.readFile(file,'utf8'));
  if(typeof profile.cad?.robot!=='string')throw Error('No robot CAD configured. Set CAD source or profile.cad.robot.');
  const asset=path.resolve(path.dirname(file),profile.cad.robot);
  await fs.access(path.join(asset,'catalog.json'));
  if(panels.has(root)){const state=panels.get(root);state.panel.reveal();return state.ready;}
  const media=path.join(context.extensionPath,'media');
  const panel=vscode.window.createWebviewPanel('cadcove.robot','Robot CAD · '+profile.name,vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[media,asset].map(p=>vscode.Uri.file(p))});
  let resolve,reject;
  const ready=new Promise((a,b)=>{resolve=a;reject=b;}),pending=new Map();
  const timer=setTimeout(()=>reject(Error('Robot CAD did not finish loading within 60 seconds')),60000);
  const state={panel,ready,pending,diagnostics:{phase:'loading'}};panels.set(root,state);
  const messages=panel.webview.onDidReceiveMessage(message=>{
   if(message?.report){state.diagnostics=message.report;if(message.report.phase==='ready'){clearTimeout(timer);resolve({ok:true,kind:'imported-assembly',...message.report});}else if(message.report.phase==='error'){clearTimeout(timer);reject(Error(message.report.error));}}
   if(message?.reply){const p=pending.get(message.reply);if(p){clearTimeout(p.timer);pending.delete(message.reply);message.error?p.reject(Error(message.error)):p.resolve(message.result);}}
  });
  panel.onDidDispose(()=>{clearTimeout(timer);reject(Error('Robot CAD closed'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Robot CAD closed'));}messages.dispose();panels.delete(root);});
  const uri=p=>panel.webview.asWebviewUri(vscode.Uri.file(p)).toString(),nonce=randomBytes(20).toString('hex');
  const config=JSON.stringify({asset:uri(asset)}).replace(/</g,'\\u003c');
  panel.webview.html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; connect-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#121820}canvas{width:100%;height:100%;display:block;touch-action:none}#status{position:absolute;bottom:8px;left:12px;color:#bbb;font:12px sans-serif;pointer-events:none}</style></head><body><canvas></canvas><div id="status">Loading robot CAD…</div><script nonce="${nonce}">window.cadcoveRobot=${config}</script><script nonce="${nonce}" src="${uri(path.join(media,'robot.js'))}"></script></body></html>`;
  return ready;
 }
 async function request(resource,method,args={}){
  const root=workspace(resource),state=panels.get(root);if(!state)throw Error('Open imported robot CAD first with open_robot_cad');await state.ready;
  return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{state.pending.delete(id);reject(Error('Robot CAD request timed out'));},15000);state.pending.set(id,{resolve,reject,timer});void state.panel.webview.postMessage({request:id,method,args});});
 }
 return {open,request,diagnostics:()=>[...panels].map(([workspace,s])=>({workspace,...s.diagnostics})),closeAll(){for(const s of [...panels.values()])s.panel.dispose();}};
}
