import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {sessionRequest,readSession} from '../../../lib/simulation-client.js';

export function simulationPanels(context,{cli,workspace,simulationProject}){
 const panels=new Map(),opening=new Map();
 async function openScene(resource){
  const root=workspace(resource),projectFile=await simulationProject(root);
  if(panels.has(projectFile)){panels.get(projectFile).panel.reveal();return;}
  const descriptor=await cli(['sim-scene','--project',projectFile],root);
  if(!descriptor.ok)throw Error(descriptor.error?.message??'Invalid simulation scene');
  const project={profilePath:descriptor.project,build:descriptor.build,profile:descriptor.profile};
  const session=await readSession(project);
  if(session.worldHash!==descriptor.worldHash)throw Error('Simulation and CAD bindings differ; rebuild and restart before opening the view.');
  const media=path.join(context.extensionPath,'media');
  const panel=vscode.window.createWebviewPanel('cadcove.simulation','Simulation · '+descriptor.profile.name,vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[media,...Object.values(descriptor.assets),descriptor.build].map(p=>vscode.Uri.file(p))});
  const state={panel,project,descriptor,disposed:false,diagnostics:{phase:'opening'},pending:new Map(),control:false,state:false};panels.set(projectFile,state);
  const uri=file=>panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
  const config={worldHash:descriptor.worldHash,profile:descriptor.profile,assets:Object.fromEntries(Object.entries(descriptor.assets).map(([k,p])=>[k,uri(p)])),bindings:uri(descriptor.bindings)};
  const nonce=randomBytes(20).toString('hex');
  const requestView=(method,args={})=>new Promise((resolve,reject)=>{
   if(state.disposed)return reject(Error('Simulation view is closed'));
   const id=randomUUID(),timer=setTimeout(()=>{state.pending.delete(id);reject(Error('Simulation view did not respond'));},15000);
   state.pending.set(id,{resolve,reject,timer});void panel.webview.postMessage({request:id,method,args});
  });
  async function capture(options={}){
   if(state.capturing)throw Error('Capture already in progress');state.capturing=true;
   try{
    const before=await readSession(project);
    const frame=await requestView('capture',options),after=await readSession(project);
    if(before.runId!==after.runId||frame.runId!==after.runId||frame.worldHash!==after.worldHash||!Number.isSafeInteger(frame.tick))throw Error('Simulation changed during capture');
    if(typeof frame.image!=='string'||!frame.image.startsWith('data:image/png;base64,')||frame.image.length>24*1024*1024)throw Error('Invalid capture image');
    const bytes=Buffer.from(frame.image.slice(22),'base64');if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Capture is not a PNG');
    const directory=path.join(project.build,'viewer');await fs.mkdir(directory,{recursive:true});
    const image=path.join(directory,'preview.png'),metadata=path.join(directory,'preview.json');
    const {image:ignored,...details}=frame;
    const report={schema:1,ok:true,...details,image,sha256:createHash('sha256').update(bytes).digest('hex'),capturedAt:new Date().toISOString()};
    await fs.writeFile(image+'.tmp',bytes);await fs.rename(image+'.tmp',image);
    await fs.writeFile(metadata+'.tmp',JSON.stringify(report,null,2));await fs.rename(metadata+'.tmp',metadata);
    return report;
   }finally{state.capturing=false;}
  }
  state.capture=capture;
  const messages=panel.webview.onDidReceiveMessage(async message=>{
   if(state.disposed||!vscode.workspace.isTrusted)return;
   if(message?.reply){const pending=state.pending.get(message.reply);if(!pending)return;clearTimeout(pending.timer);state.pending.delete(message.reply);message.error?pending.reject(Error(message.error)):pending.resolve(message.result);return;}
   if(!Number.isSafeInteger(message?.id))return;
   const respond=value=>panel.webview.postMessage({id:message.id,...value});
   let lock;
   try{
    const {method,args={}}=message;let result;
    if(method==='state'){
     lock='state';if(state.state){lock=null;throw Error('Request already in flight');}state.state=true;
     result=await sessionRequest(project,'state',{timeout:2000});
    }else if(method==='report'){
     if(JSON.stringify(args).length>16000)throw Error('Invalid simulation diagnostics');state.diagnostics=args;result=true;
    }else throw Error('Unknown simulation view request');
    await respond({result});
   }catch(error){await respond({error:error.message});}finally{if(lock)state[lock]=false;}
  });
  const token=randomBytes(32).toString('hex'),viewerId=randomUUID(),file=path.join(project.build,'cadcove-viewer.json');
  let accepting=true;
  const server=createServer(async(req,res)=>{
   const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   if(!vscode.workspace.isTrusted||!accepting||req.headers.authorization!=='Bearer '+token){send(401,{ok:false,error:'Viewer access denied'});return;}
   if(req.method!=='POST'||!['/capture','/view','/state','/practice'].includes(req.url)){send(404,{ok:false,error:'Unknown viewer request'});return;}
   try{
    let text='';for await(const bytes of req){text+=bytes;if(text.length>16000)throw Error('Viewer request too large');}
    const args=JSON.parse(text||'{}');let result;
    if(req.url==='/capture')result=await capture(args);
    else if(req.url==='/view')result=await requestView('view',args);
    else if(req.url==='/practice'){
     result=await requestView('practice',args);
    }
    else result={schema:1,ok:true,...state.diagnostics};
    send(200,result);
   }catch(error){send(400,{ok:false,error:error.message});}
  });
  panel.onDidDispose(()=>{
   accepting=false;state.disposed=true;panels.delete(projectFile);messages.dispose();server.close();server.closeAllConnections();
   for(const pending of state.pending.values()){clearTimeout(pending.timer);pending.reject(Error('Simulation view closed'));}state.pending.clear();
   void fs.readFile(file,'utf8').then(JSON.parse).then(value=>{if(value.viewerId===viewerId)return fs.unlink(file);}).catch(()=>{});

  });
  server.requestTimeout=20000;server.headersTimeout=5000;
  try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   if(state.disposed)throw Error('Simulation view closed while opening');
   await fs.writeFile(file,JSON.stringify({schema:1,viewerId,project:project.profilePath,endpoint:'http://127.0.0.1:'+server.address().port,token}),{mode:0o600});
   if(state.disposed){await fs.unlink(file);throw Error('Simulation view closed while opening');}
  }catch(error){server.close();panel.dispose();panels.delete(projectFile);messages.dispose();throw error;}
  panel.webview.html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${panel.webview.cspSource}; img-src data:;"><meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0c1115;color:#d9e2eb;font:12px system-ui}canvas{width:100%;height:100%;display:block;touch-action:none}footer{position:absolute;bottom:10px;left:12px;pointer-events:none}#status{background:#0c1115aa;padding:4px 7px;border-radius:4px;font-variant-numeric:tabular-nums}</style></head><body><canvas tabindex="0"></canvas><footer><span id="status"></span></footer><script nonce="${nonce}">window.cadcoveSimulation=${JSON.stringify(config).replace(/</g,String.fromCharCode(92)+'u003c')};</script><script nonce="${nonce}" src="${uri(path.join(media,'simulation.js'))}"></script></body></html>`;
  return {ok:true,project:projectFile};
 }
 function open(resource){const root=workspace(resource);if(opening.has(root))return opening.get(root);const result=openScene(resource).finally(()=>opening.delete(root));opening.set(root,result);return result;}
 return {open,diagnostics:()=>[...panels.values()].map(s=>({project:s.project.profilePath,...s.diagnostics})),capture:async resource=>{const root=workspace(resource),file=await simulationProject(root),state=panels.get(file);if(!state)throw Error('Open the simulation view before capture');return state.capture();},closeAll(){for(const s of panels.values())s.panel.dispose();}};
}
