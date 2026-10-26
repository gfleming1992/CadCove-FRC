import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as vscode from 'vscode';
import {PhysicsBuildPool} from '../../../lib/physics-build-pool.js';
import {PhysicsCoordinator} from '../../../lib/physics-coordinator.js';
import {preparePhysics} from '../../../lib/physics-preparation.js';
import {physicalModel} from '../../../lib/physical-model.js';
import {cacheFile,readSources} from '../../../vendor/cad-core/extensions/vscode/src/project-files.js';
import {decodeScene} from '../../../vendor/cad-core/src/core/mesh.js';
import {isStepFile,readStepSource} from '../../../vendor/cad-core/extensions/vscode/src/step-source.js';
import {snapshot} from '../../../vendor/cad-core/src/core/revision.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
// Optional product services attached to the existing persistent CAD canvas.
export function sceneServices({ensureRuntime,simulationProject,cli}){
 const scenes=new Map(),pool=new PhysicsBuildPool(2);
 async function integrate(state){
  // Declare roots before the HTML starts. Updating webview options during a
  // request reloads the canvas in VS Code and loses its pending response/camera.
  const roots=[...(state.panel.webview.options.localResourceRoots??[]),vscode.Uri.file(state.layout.workspaceRoot)];
  try{const file=await simulationProject(state.layout.workspaceRoot),profile=JSON.parse(await fs.readFile(file,'utf8'));for(const value of [profile.cad?.robot,profile.cad?.field,profile.build])if(typeof value==='string')roots.push(vscode.Uri.file(path.resolve(path.dirname(file),value)));}catch{/* CAD can open before simulation is configured. */}
  state.panel.webview.options={...state.panel.webview.options,localResourceRoots:roots};
  const assertAssetRoot=file=>{if(!roots.some(root=>{const relative=path.relative(root.fsPath,file);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}))throw Error('External scene asset path changed; reopen the CAD scene to load '+file);};
  const key=state.layout.workspaceRoot+'\0'+state.entry;
  const step=state.resource&&isStepFile(state.resource.fsPath),stepRelative=step?path.relative(state.root,state.resource.fsPath).split(path.sep).join('/'):null;
  const definitionFile=path.join(step?path.dirname(state.resource.fsPath):path.join(state.root,path.dirname(state.entry)),'mechanism.json');
  let closed=false,refresh=0,lastSignature,definition,partIds,geometry,metadataTimer;
  let meshAssetPaths=new Set();
  const send=message=>{if(!closed)void state.panel.webview.postMessage({sceneEvent:message});};
  const coordinator=new PhysicsCoordinator({prepare:(model,options)=>pool.run(async()=>{
   const exe=await ensureRuntime();if(options.signal.aborted)throw Error('Build superseded');
   return preparePhysics(path.join(path.dirname(exe),process.platform==='win32'?'instantcad-sim.exe':'instantcad-sim'),model,{...options,assetRoot:state.layout.workspaceRoot});
  },options.signal),onEvent:event=>send({readiness:event}),onState:frame=>send({physics:frame})});
  const record={state,coordinator,assertAssetRoot};scenes.set(key,record);
  async function update(){
   const generation=++refresh;
   try{
    const text=await fs.readFile(definitionFile,'utf8');
    const binary=await cacheFile(state.layout,state.entry,'scene.bin'),bytes=await fs.readFile(binary);
    const source=step?await readStepSource(state.root,stepRelative):await readSources(state.root,state.layout.buildRoot);
    // Cache metadata is compared with the viewer's successful revision. Its
    // content hash binds the geometry used to build each dependency component.
    const meta=JSON.parse(await fs.readFile(await cacheFile(state.layout,state.entry,'scene.json'),'utf8'));
    if(meta.revision!==state.diagnostics.revision||hash(bytes)!==meta.meshHash)throw Error('Waiting for current CAD cache');
    const current=await snapshot(source,state.entry,meta.runtime);
    if(current.revision!==meta.revision)throw Error('CAD source changed during physics preparation');
    const signature=hash(text+meta.meshHash);
    if(generation!==refresh||closed)return;
    const decoded=decodeScene(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    definition=JSON.parse(text);record.error=null;record.sourceCurrent=true;
    if(definition.sourceStep&&source[definition.sourceStep.file]!=='sha256:'+definition.sourceStep.sha256)throw Error('STEP kinematics source pin is stale');
    partIds=decoded.parts.map(p=>p.id);geometry=Object.fromEntries(decoded.parts.map(p=>[p.id,p.geometryKey]));
    const model=physicalModel(definition,partIds);
    for(const b of model.bodies)if(!b.parts.length&&b.collision.shapes.some(s=>s.kind==='mesh_file'))throw Error('Mesh-only body '+b.id+' requires explicit CAD visual geometry for this canvas');
    meshAssetPaths=new Set(model.bodies.flatMap(b=>b.collision.shapes.filter(s=>s.kind==='mesh_file').map(s=>path.resolve(state.layout.workspaceRoot,s.file))));
    for(const file of [...meshAssetPaths])try{meshAssetPaths.add(await fs.realpath(file));}catch{/* Candidate reports missing assets. */}
    if(model.bodies.some(b=>b.source)){const hashes=new Set([current.revision,...Object.values(source).map(text=>text.startsWith('sha256:')?text.slice(7):hash(text))]);for(const b of model.bodies)if(b.source&&!hashes.has(b.source.sha256))throw Error('Physical body source binding is stale: '+b.id);}
    if(signature!==lastSignature||[...coordinator.records.values()].some(r=>r.phase==='outdated')){
     send({definition,model});lastSignature=signature;coordinator.update(model,geometry);
    }
   }catch(e){if(!closed&&generation===refresh){lastSignature=undefined;record.error=e.code==='ENOENT'?'Add mechanism.json with physical properties to enable physics':e.message;send({error:record.error});}}
  }
  async function field(){
   const file=await simulationProject(state.layout.workspaceRoot),profile=JSON.parse(await fs.readFile(file,'utf8'));
   const root=path.resolve(path.dirname(file),profile.cad.field);
   assertAssetRoot(root);
   const assembly=JSON.parse(await fs.readFile(path.join(root,'assembly.json'),'utf8'));
   const project=JSON.parse(await fs.readFile(path.join(state.layout.workspaceRoot,'.cadcove/project.json'),'utf8'));
   const defaultPositionMm=project.fieldPlacement?.positionMm;
   if(defaultPositionMm!==undefined&&(!Array.isArray(defaultPositionMm)||defaultPositionMm.length!==3||!defaultPositionMm.every(Number.isFinite)))throw Error('Invalid default field placement');
   return {ok:true,field:state.panel.webview.asWebviewUri(vscode.Uri.file(root)).toString(),revision:assembly.sourceHash,defaultPositionMm};
  }
  record.request=async(method,args={})=>{
   if(method==='physics-particles'){
    if(args.action==='disable'){for(const r of coordinator.records.values())r.session?.disableParticles?.();send({particlesDisabled:true});return {ok:true,enabled:false};}
    if(args.action!=='enable')throw Error('Use physics-particles action enable or disable');
    if(record.error||!record.sourceCurrent)throw Error(record.error??'Wait for current physics definition');
    if(coordinator.running)throw Error('Pause physics before configuring particles');
    const gate=coordinator.gate(args.bodyIds);if(!gate.ok)return gate;
    if(gate.components.length!==1)throw Error('Select deformable bodies within one connected physics component');
    const component=coordinator.records.get(gate.components[0]);
    const stream=component.session.configureParticles({bodyIds:args.bodyIds,maxHz:args.maxHz,revision:component.hash});
    for(const r of coordinator.records.values())if(r!==component)r.session?.disableParticles?.();
    return {ok:true,enabled:true,component:component.id,...stream,sourceRevision:state.diagnostics.revision};
   }
   if(method==='physics-status')return {...coordinator.status(args.after??0),error:record.error};
   if(method==='physics-wait'){
    const until=Date.now()+Math.min(25000,Math.max(0,args.timeoutMs??10000)),after=args.after??coordinator.sequence;
    while(!closed&&coordinator.sequence<=after&&Date.now()<until)await new Promise(r=>setTimeout(r,50));
    return {...coordinator.status(after),closed};
   }
   if(method==='field')return field();
   if(method==='physics'){if(record.error)return {ok:false,pending:false,reason:record.error};if(args.initialAngles&&definition&&!definition.physical&&record.sourceCurrent)coordinator.update(physicalModel(definition,partIds,args.initialAngles),geometry);const result=coordinator.start(args.ids);if(result.ok)send({mode:'physics'});return result;}
   if(method==='motors')return coordinator.motors(args);
   if(method==='zero'){for(const r of coordinator.records.values())r.session?.zero();return {ok:true};}
   if(method==='cad'){for(const r of coordinator.records.values())r.session?.disableParticles?.();coordinator.pause();send({mode:'cad'});return {ok:true};}
   throw Error('Unknown scene service '+method);
  };
  const invalidate=()=>{record.invalidated=true;record.sourceCurrent=false;record.error=null;refresh++;for(const r of coordinator.records.values())r.session?.disableParticles?.();coordinator.invalidate();send({outdated:true});};
  const metadataWatcher=step?vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(definitionFile)),'mechanism.json')):null;
  const metadataChanged=()=>{invalidate();clearTimeout(metadataTimer);metadataTimer=setTimeout(()=>void update(),200);};
  const meshWatcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(state.layout.workspaceRoot),'**/*.ctm'));
  const meshChanged=uri=>{if(meshAssetPaths.has(path.resolve(uri.fsPath)))metadataChanged();};
  meshWatcher.onDidChange(meshChanged);meshWatcher.onDidCreate(meshChanged);meshWatcher.onDidDelete(meshChanged);
  metadataWatcher?.onDidChange(metadataChanged);metadataWatcher?.onDidCreate(metadataChanged);metadataWatcher?.onDidDelete(metadataChanged);
  return {concurrent:method=>typeof method==='string'&&method.startsWith('scene:'),request:(method,args)=>{if(!method.startsWith('scene:'))throw Error('Unknown CAD host request');return record.request(method.slice(6),args);},
   report:report=>{if(report.phase==='ready'&&!state.imported)void update();},
   invalidate,
   dispose:()=>{closed=true;clearTimeout(metadataTimer);metadataWatcher?.dispose();meshWatcher.dispose();coordinator.close();scenes.delete(key);}};
 }
 return {integrate,scenes,async request(root,entry,method,args){const scene=scenes.get(root+'\0'+entry);if(!scene)throw Error('Open the CAD scene first');return scene.request(method,args);}};
}
