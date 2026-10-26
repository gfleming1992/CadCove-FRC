import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readSession,sessionRequest} from '../../../lib/simulation-client.js';
// Compatibility bridge for the existing sim-view/capture CLI. Rendering attaches
// to the workspace's persistent CAD scene instead of creating another webview.
export function simulationPanels(context,{cli,workspace,simulationProject,openScene,scenes}){
 const attached=new Map();
 async function open(resource){
  const root=workspace(resource);await openScene(resource);
  const record=[...scenes.scenes.values()].find(r=>r.state.layout.workspaceRoot===root&&r.state.panel.active)??[...scenes.scenes.values()].find(r=>r.state.layout.workspaceRoot===root);
  if(!record)throw Error('Open the workspace CAD scene first');
  const state=record.state;const readyUntil=Date.now()+120000;while(state.diagnostics.phase!=='ready'&&Date.now()<readyUntil){if(state.disposed||state.diagnostics.phase==='error')throw Error(state.diagnostics.error??'CAD failed');await new Promise(r=>setTimeout(r,50));}if(state.diagnostics.phase!=='ready')throw Error('CAD scene loading timed out');
  const projectFile=await simulationProject(root),descriptor=await cli(['sim-scene','--project',projectFile],root);
  if(!descriptor.ok)throw Error(descriptor.error?.message??'Invalid simulation scene');
  const project={profilePath:descriptor.project,build:descriptor.build,profile:descriptor.profile},session=await readSession(project);
  if(session.worldHash!==descriptor.worldHash)throw Error('Simulation/CAD revision mismatch; rebuild and restart');
  attached.get(root)?.close();record.coordinator.pause();
  for(const file of [...Object.values(descriptor.assets),descriptor.build])record.assertAssetRoot(file);
  const bindings=JSON.parse(await fs.readFile(descriptor.bindings,'utf8'));
  if(bindings.worldHash!==descriptor.worldHash)throw Error('Simulation bindings changed during attachment');
  // Only occurrence frames cross this boundary; the scene already owns meshes.
  if(state.imported){if(state.asset!==descriptor.assets.robot)throw Error('Open the simulation project\'s robot CAD before attaching physics');}
  else if(bindings.sourceRevision!==state.diagnostics.revision&&path.dirname(state.resource.fsPath)!==descriptor.assets.robot)throw Error('Open the simulation project\'s CAD source before attaching physics');
  const revision=state.diagnostics.revision??null;
  const nodes=state.imported?null:JSON.parse(await fs.readFile(path.join(descriptor.assets.robot,'instances.json'),'utf8'));
  const world=JSON.parse(await fs.readFile(path.join(descriptor.build,'world.json'),'utf8'));
  await state.requestView('field',{revision:bindings.fieldSourceHash});
  const config={worldHash:descriptor.worldHash,bindings,revision,nativeFrames:nodes?Object.fromEntries(nodes.map(n=>[n.id,n.transform])):null,bodyIds:world.bodies.map(b=>b.id)};
  // Requests are acknowledged by the same persistent canvas.
  await state.requestView('attach-simulation',config);
  let closed=false,timer,latest,error,view=await state.requestView('simulation-state');
  const send=message=>state.panel.webview.postMessage({sceneEvent:message});
  async function poll(){if(closed)return;try{latest=await sessionRequest(project,'state');if(latest.worldHash!==config.worldHash||latest.runId!==session.runId)throw Error('Simulation revision changed');if(record.invalidated)throw Error('CAD changed; rebuild physics before using this scene');error=null;await send({simulationState:latest});view=await state.requestView('simulation-state');}catch(e){error=e.message;await send({error,outdated:true});}if(!closed)timer=setTimeout(poll,33);}
  const request=async(method,args={})=>{
   if(method==='state')return {...await state.requestView('simulation-state'),phase:error?'error':'ready',error};
   if(method==='practice')throw Error('Use WPILib Driver Station to drive');
   if(method==='view'){const result=await state.requestView('simulation-view',args);view={...view,...result};return result;}
   if(method!=='capture')throw Error('Unknown simulation view request');
   if(!latest||error||record.invalidated)throw Error(error??'Simulation is not ready');
   const before=latest,frame=await state.requestView('simulation-capture',args);
   if(record.invalidated||before.runId!==latest.runId||frame.worldHash!==session.worldHash||frame.runId!==session.runId||!Number.isSafeInteger(frame.tick))throw Error('Scene changed during capture');
   const bytes=Buffer.from(frame.image.split(',')[1],'base64'),directory=path.join(project.build,'viewer');await fs.mkdir(directory,{recursive:true});
   const image=path.join(directory,'preview.png');await fs.writeFile(image,bytes);
   const result={...frame,image,ok:true,runId:before.runId,worldHash:before.worldHash,tick:frame.tick,sha256:createHash('sha256').update(bytes).digest('hex')};await fs.writeFile(path.join(directory,'preview.json'),JSON.stringify(result));return result;
  };
  const token=randomBytes(32).toString('hex'),viewerId=randomUUID(),file=path.join(project.build,'cadcove-viewer.json');
  const server=createServer(async(req,res)=>{const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
   if(closed||!vscode.workspace.isTrusted||req.headers.authorization!=='Bearer '+token)return reply(401,{ok:false,error:'Viewer access denied'});
   if(req.method!=='POST'||!['/capture','/state','/view','/practice'].includes(req.url))return reply(404,{ok:false,error:'Unknown viewer request'});
   try{let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)throw Error('Request too large');}reply(200,await request(req.url.slice(1),JSON.parse(body||'{}')));}catch(e){reply(400,{ok:false,error:e.message});}
  });
  const close=()=>{if(closed)return;closed=true;clearTimeout(timer);void send({mode:'cad'});server.close();server.closeAllConnections();void fs.readFile(file,'utf8').then(JSON.parse).then(v=>{if(v.viewerId===viewerId)return fs.unlink(file);}).catch(()=>{});attached.delete(root);};
  server.requestTimeout=20000;server.headersTimeout=5000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});await fs.writeFile(file,JSON.stringify({schema:1,viewerId,project:projectFile,endpoint:'http://127.0.0.1:'+server.address().port,token}),{mode:0o600});}catch(e){close();throw e;}
  state.panel.onDidDispose(close);record.invalidated=false;attached.set(root,{close,request,state,session,diagnostics:()=>({...view,phase:error?'error':latest?'ready':'loading',error})});void poll();return {ok:true,project:projectFile,unifiedScene:true};
 }
 return {open,capture:resource=>{const r=attached.get(workspace(resource));if(!r)throw Error('Open live simulation first');return r.request('capture');},diagnostics:()=>[...attached].map(([workspace,r])=>({workspace,...r.diagnostics(),runId:r.session.runId,unifiedScene:true})),closeAll(){for(const r of [...attached.values()])r.close();}};
}
