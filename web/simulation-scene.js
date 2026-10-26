// Shared by the browser demo and editor webview. This layer owns the CAD/mm to
// physics/metres conversion; rendering still uses the pinned generic CAD core.
import {decodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {compose,inverse,translation,cadMetres,quaternionMatrix} from '../lib/transforms.js';
import {validateSceneBindings} from '../lib/scene-bindings.js';
export const gpuMatrix=m=>m.map((v,i)=>i%4===3?v:v/1000);
export const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export function assetURL(root,relative){
 if(typeof relative!=='string'||relative.split('/').some(p=>!p||p==='.'||p==='..')||/[\\:?#\x00-\x1f]/.test(relative))throw Error('Invalid CAD asset path');
 return root.replace(/\/$/,'')+'/'+relative.split('/').map(encodeURIComponent).join('/');
}
export async function loadAssembly(name,root,{group='',cache=new Map(),fetcher=fetch,includeLods=false}={}){
 const json=async file=>{const r=await fetcher(assetURL(root,file));if(!r.ok)throw Error('Missing CAD '+file);return r.json();};
 const [catalog,all]=await Promise.all([json('catalog.json'),json('instances.json')]);
 let selected=group?all.filter(n=>n.id===group||n.id.startsWith(group+'/')):all;
 const appearanceResponse=await fetcher(assetURL(root,'appearance.json'));
 if(appearanceResponse.ok){
  const appearance=await appearanceResponse.json();
  if(appearance.schema!==1||appearance.instancesHash!==await digest(new TextEncoder().encode(JSON.stringify(all))))throw Error('Stale CAD appearance: rebuild appearance cache');
  Object.assign(catalog,appearance.catalog);
  selected=selected.flatMap(n=>{const style=appearance.instances[n.id];if(!style)throw Error('Missing CAD appearance '+n.id);const displayed={...n,viewOffset:style.offset};return style.parts?style.parts.map((part,i)=>({...displayed,...part,id:n.id+'/surface/'+i,sourceId:n.id})):[{...displayed,asset:style.asset??displayed.asset,color:style.color,opacity:style.opacity??1}];});
 }else if(appearanceResponse.status!==404)throw Error('Cannot load CAD appearance');
 for(const n of selected)if(n.opacity!==undefined&&(!Number.isFinite(n.opacity)||n.opacity<0||n.opacity>1))throw Error('Invalid CAD material opacity');
 const used=[...new Set(selected.map(n=>n.asset))],loaded=[],levels=new Map();let cursor=0;
 const loadMesh=async c=>{
  if(!c||!/^[a-f0-9]{64}$/.test(c.meshSha256))throw Error('Invalid CAD mesh descriptor');
  let mesh=cache.get(c.meshSha256);
  if(!mesh){const r=await fetcher(assetURL(root,c.mesh));if(!r.ok)throw Error('Missing mesh');const bytes=await r.arrayBuffer();if(await digest(bytes)!==c.meshSha256)throw Error('Mesh integrity mismatch');const decoded=decodeScene(bytes);if(decoded.parts.length!==1)throw Error('Expected one mesh prototype');mesh=decoded.parts[0];cache.set(c.meshSha256,mesh);}
  return mesh;
 };
 await Promise.all(Array.from({length:8},async()=>{while(cursor<used.length){
  const asset=used[cursor++],c=catalog[asset],mesh=await loadMesh(c);
  loaded.push({...mesh,id:name+'/'+asset});
  if(includeLods&&c.lods){
   if(!Array.isArray(c.lods)||c.lods.length>5)throw Error('Invalid visual levels');const variants=[];
   for(const [i,d]of c.lods.entries()){if(!Number.isFinite(d.errorMM)||d.errorMM<0)throw Error('Invalid visual error');const id=name+'/'+asset+'/lod/'+i;loaded.push({...await loadMesh(d),id});variants.push({asset:id,errorMetres:d.errorMM/1000});}
   levels.set(asset,variants);
  }
 }}));
 return {prototypes:loaded,instances:selected.map(n=>({...n,lods:levels.get(n.asset),id:name+'/'+n.id,sourceId:n.sourceId??n.id,asset:name+'/'+n.asset,matrix:compose(translation((n.viewOffset||[0,0,0]).map(v=>v/1000)),cadMetres(n.transform)),color:n.color}))};
}
export function bindSimulationScene(robot,field,bindings){
 validateSceneBindings(bindings);
 for(const n of robot.instances){const b=bindings.robot[n.sourceId];if(!b)throw Error('Unbound CAD occurrence '+n.sourceId);n.body=b.body;n.local=b.local;n.matrix=compose(translation(bindings.start),n.matrix);}
 for(const n of field.instances){const b=bindings.field[n.sourceId];if(b){n.body=b.body;n.local=b.local??compose(inverse(translation(b.bindPosition)),n.matrix);}n.matrix=compose(translation(bindings.fieldOrigin),n.matrix);}
 return {prototypes:[...robot.prototypes,...field.prototypes],instances:[...robot.instances,...field.instances].map(n=>({...n,transform:gpuMatrix(n.matrix)}))};
}
export function poseTransforms(instances,state){
 const changes={},matrices=new Map();
 for(const n of instances)if(n.body){
  const pose=state.bodies[n.body];if(!pose)throw Error('Missing simulated body '+n.body);
  if(!matrices.has(n.body))matrices.set(n.body,quaternionMatrix(pose.quaternion,pose.position));
  changes[n.id]=gpuMatrix(compose(matrices.get(n.body),n.local));
 }
 return changes;
}

// Bind the viewport's existing occurrences; never replace its meshes or IDs.
// Native CAD meshes have occurrence placement baked into their vertices, whereas
// imported assemblies retain prototype-local meshes. Account for that once here.
export function bindPersistentScene({robot,field,physical,nativeFrames},bindings,bodyIds=[]){
 validateSceneBindings(bindings);
 const bodies=new Set(bodyIds),instances=[];
 for(const n of robot.instances){
  const source=n.sourceId??n.id,b=bindings.robot[source];
  if(!b)throw Error('Unbound CAD occurrence '+source);
  let local=b.local;
  if(nativeFrames){
   const frame=nativeFrames[source];
   if(!frame)throw Error('Missing native CAD occurrence frame '+source);
   // Reuse the rigid-frame validator before inversion.
   validateSceneBindings({...bindings,robot:{[source]:{body:b.body,local:cadMetres(frame)}}});
   local=compose(local,inverse(cadMetres(frame)));
  }
  instances.push({...n,scope:'robot',body:b.body,local});
 }
 const rendered=new Set(robot.instances.map(n=>n.sourceId??n.id));
 for(const id of Object.keys(bindings.robot))if(!rendered.has(id))throw Error('Simulation occurrence missing from CAD scene: '+id);
 for(const n of field.instances){
  const b=bindings.field[n.sourceId];
  instances.push({...n,scope:'field',...(b?{body:b.body,local:b.local??compose(inverse(translation(b.bindPosition)),n.matrix)}:{}),transform:gpuMatrix(compose(translation(bindings.fieldOrigin),n.matrix))});
 }
 for(const n of physical.instances){
  const b=physical.bindings.find(b=>b.id===n.id);
  instances.push({...n,scope:'robot',...(b&&bodies.has(b.body)?{body:b.body,local:b.local}:{})});
 }
 return {instances};
}

// Presentation only: retain the authoritative physics world and body IDs.
export function selectSimulationBodies(instances, bodies) {
 if (bodies === null) return instances;
 if (!Array.isArray(bodies) || !bodies.length || bodies.some(id => typeof id !== 'string' || !id)) throw Error('bodies must be a nonempty list or null to show all');
 const known = new Set(instances.map(n => n.body).filter(Boolean));
 for (const id of bodies) if (!known.has(id)) throw Error('Unknown rendered body '+id);
 const selected = new Set(bodies);
 return instances.filter(n => selected.has(n.body));
}
