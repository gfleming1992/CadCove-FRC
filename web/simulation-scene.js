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
export async function loadAssembly(name,root,{group='',cache=new Map(),fetcher=fetch}={}){
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
 const used=[...new Set(selected.map(n=>n.asset))],loaded=[];let cursor=0;
 await Promise.all(Array.from({length:8},async()=>{while(cursor<used.length){
  const asset=used[cursor++],c=catalog[asset];if(!c||!/^[a-f0-9]{64}$/.test(c.meshSha256))throw Error('Invalid CAD mesh descriptor');
  let mesh=cache.get(c.meshSha256);
  if(!mesh){const r=await fetcher(assetURL(root,c.mesh));if(!r.ok)throw Error('Missing mesh');const bytes=await r.arrayBuffer();if(await digest(bytes)!==c.meshSha256)throw Error('Mesh integrity mismatch');const decoded=decodeScene(bytes);if(decoded.parts.length!==1)throw Error('Expected one mesh prototype');mesh=decoded.parts[0];cache.set(c.meshSha256,mesh);}
  loaded.push({...mesh,id:name+'/'+asset});
 }}));
 return {prototypes:loaded,instances:selected.map(n=>({...n,id:name+'/'+n.id,sourceId:n.sourceId??n.id,asset:name+'/'+n.asset,matrix:compose(translation((n.viewOffset||[0,0,0]).map(v=>v/1000)),cadMetres(n.transform)),color:n.color}))};
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
