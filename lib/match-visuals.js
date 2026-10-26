// Offline, CPU-only visual derivatives. CAD sources, body bindings and collision
// assets are never edited. Error estimates are rendering metrics, not CAD tolerances.
import path from 'node:path';
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {MeshoptSimplifier as simplifier} from 'meshoptimizer/simplifier';
import {encodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {loadAssembly} from '../web/simulation-scene.js';
import {sha256} from './match-assets.js';

export async function simplifyVisual(part,errorMM,ratio=.05){
 await simplifier.ready;
 if(!Number.isFinite(errorMM)||errorMM<=0||!Number.isFinite(ratio)||ratio<=0||ratio>1)throw Error('Invalid visual simplification settings');
 const target=Math.min(part.indices.length,Math.max(12,Math.floor(part.indices.length*ratio/3)*3));
 const [indices,error]=simplifier.simplifyWithAttributes(part.indices,part.positions,3,part.normals,3,[.5,.5,.5],null,target,errorMM,['ErrorAbsolute','Permissive']);
 const [remap,count]=simplifier.compactMesh(indices),positions=new Float32Array(count*3),normals=new Float32Array(count*3);
 for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff){positions.set(part.positions.subarray(i*3,i*3+3),remap[i]*3);normals.set(part.normals.subarray(i*3,i*3+3),remap[i]*3);}
 return {part:{id:part.id,name:part.name,color:part.color,positions,normals,indices},errorMM:error};
}
export async function prepareMatchVisuals({robot,field,output,errorsMM=[.25,1,4],onProgress=()=>{}}){
 if(!Array.isArray(errorsMM)||!errorsMM.length||errorsMM.length>5||errorsMM.some((e,i)=>!Number.isFinite(e)||e<=0||(i&&e<=errorsMM[i-1])))throw Error('Visual errors must be a growing list of 1–5 positive millimetre values');
 const destination=path.resolve(output);await mkdir(destination,{recursive:false});
 const report={schema:1,tool:'meshoptimizer-1.3.0',errorsMM,assemblies:{},physicsChanged:false};
 for(const [name,input]of Object.entries({robot,field})){
  const root=await realpath(input),dir=path.join(destination,name);await mkdir(dir);await mkdir(path.join(dir,'meshes'));
  const fetcher=async url=>{const file=await realpath(decodeURIComponent(url)).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!file)return new Response('',{status:404});if(!file.startsWith(root+path.sep))throw Error('CAD asset escaped its root');return new Response(await readFile(file));};
  const assembly=await loadAssembly(name,root,{fetcher}),catalog={},counts=new Map();for(const n of assembly.instances)counts.set(n.asset,(counts.get(n.asset)||0)+1);
  const stats={instances:assembly.instances.length,prototypes:assembly.prototypes.length,originalTriangles:0,lodTriangles:errorsMM.map(()=>0),meshBytes:0};
  const save=async part=>{const bytes=new Uint8Array(encodeScene({parts:[part]})),hash=sha256(bytes),mesh='meshes/'+hash+'.bin';await writeFile(path.join(dir,mesh),bytes);stats.meshBytes+=bytes.length;return {mesh,meshSha256:hash,meshBytes:bytes.length,triangles:part.indices.length/3};};
  for(const part of assembly.prototypes){
   const descriptor=await save(part),count=counts.get(part.id);stats.originalTriangles+=descriptor.triangles*count;descriptor.lods=[];
   for(const [i,errorMM]of errorsMM.entries()){
    const result=await simplifyVisual(part,errorMM);const lod={...await save(result.part),errorMM:result.errorMM};descriptor.lods.push(lod);stats.lodTriangles[i]+=lod.triangles*count;
   }
   catalog[part.id.slice(name.length+1)]=descriptor;onProgress({assembly:name,completed:Object.keys(catalog).length,total:assembly.prototypes.length});
  }
  // Flatten appearance parts while retaining each original binding sourceId.
  const instances=assembly.instances.map(n=>({id:n.id.slice(name.length+1),sourceId:n.sourceId,asset:n.asset.slice(name.length+1),color:n.color,opacity:n.opacity??1,transform:n.matrix.map((v,i)=>i%4===3?v*1000:v)}));
  await writeFile(path.join(dir,'catalog.json'),JSON.stringify(catalog));await writeFile(path.join(dir,'instances.json'),JSON.stringify(instances));report.assemblies[name]=stats;
 }
 await writeFile(path.join(destination,'visual-report.json'),JSON.stringify(report,null,2)+'\n');return {output:destination,...report};
}
export async function matchVisualsCommand(options){
 if(!options.robot||!options.field||!options.output)throw Error('match-visuals requires --robot, --field and --output');
 return {ok:true,...await prepareMatchVisuals({robot:options.robot,field:options.field,output:options.output})};
}
