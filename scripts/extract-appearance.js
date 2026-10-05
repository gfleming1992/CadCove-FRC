// Recover STEP surface/face styles via OCCT's XCAF presentation exporter.
// getLabelInfo() in occt-wasm 5.3.2 reports generic label colors only.
// This separate view artifact leaves CAD/collision hashes and identities intact.
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {OcctKernel} from 'occt-wasm';
import {encodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {compose,identity,quaternionMatrix,cadMetres} from '../lib/transforms.js';
const root=process.argv[2]||'assets/fields/2026',source=process.argv[3]||path.join(root,'field.step');
const hash=b=>createHash('sha256').update(b).digest('hex');
const input=await Bun.file(source).text(),assembly=await Bun.file(path.join(root,'assembly.json')).json();
if(hash(input)!==assembly.sourceHash)throw Error('STEP revision differs from extracted assembly');
const instances=await Bun.file(path.join(root,'instances.json')).json(),expected=new Map(instances.map(n=>[n.id,n]));
const kernel=await OcctKernel.init({wasm:await Bun.file('node_modules/occt-wasm/dist/occt-wasm.wasm').arrayBuffer()});
const doc=kernel.importXCAFFromSTEP(input);
let bytes;
try{bytes=doc.exportGLTF({linearDeflection:1,angularDeflection:.4});}finally{doc.close();kernel[Symbol.dispose]();}
const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),jsonLength=view.getUint32(12,true);
const gltf=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonLength))),binary=20+jsonLength+8;
const srgb=rgb=>'#'+rgb.slice(0,3).map(v=>Math.round(255*Math.max(0,Math.min(1,v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055))).toString(16).padStart(2,'0')).join('');
function readAccessor(id,type){
 const a=gltf.accessors[id],b=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3}[a.type];
 if(!size||a.type!==type||a.sparse||a.normalized||b.buffer!==0)throw Error('Unsupported presentation accessor');
 const width={5123:2,5125:4,5126:4}[a.componentType],method={5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[a.componentType];
 if(!width)throw Error('Unsupported presentation component');
 const out=new (type==='SCALAR'?Uint32Array:Float32Array)(a.count*size),offset=binary+(b.byteOffset||0)+(a.byteOffset||0),stride=b.byteStride||size*width;
 for(let i=0;i<a.count;i++)for(let k=0;k<size;k++)out[i*size+k]=view[method](offset+i*stride+k*width,true);
 return out;
}
const appearance={schema:1,sourceHash:assembly.sourceHash,instancesHash:hash(JSON.stringify(instances)),instances:{},catalog:{}},writes=new Map();
function walk(index,id,parent){
 const node=gltf.nodes[index];if(node.matrix||node.scale?.some(x=>x!==1))throw Error('Unsupported presentation placement');
 const matrix=compose(parent,quaternionMatrix(node.rotation||[0,0,0,1],node.translation));
 if(node.mesh!==undefined){
  const original=expected.get(id);if(!original||original.name!==node.name)throw Error('Presentation occurrence mismatch '+id);
  if(matrix.some((v,k)=>Math.abs(v-cadMetres(original.transform)[k])>1e-6))throw Error('Presentation transform mismatch '+id);
  const primitives=gltf.meshes[node.mesh].primitives;
  const colors=primitives.map(p=>srgb(gltf.materials[p.material]?.pbrMetallicRoughness?.baseColorFactor||[.5,.5,.5,1]));
  if(new Set(colors).size===1)appearance.instances[id]={color:colors[0]};
  else {
   const parts=[];
   for(const color of new Set(colors)){
    const group=primitives.filter((p,i)=>colors[i]===color),vertices=[],normalValues=[],triangles=[];
    for(const p of group){
    if(p.mode!==undefined&&p.mode!==4)throw Error('Expected triangles');
    const positions=readAccessor(p.attributes.POSITION,'VEC3');for(let k=0;k<positions.length;k++)positions[k]*=1000;
    const normals=readAccessor(p.attributes.NORMAL,'VEC3'),indices=readAccessor(p.indices,'SCALAR');
    const offset=vertices.length/3;for(const value of positions)vertices.push(value);for(const value of normals)normalValues.push(value);for(const value of indices)triangles.push(value+offset);
    }
    const positions=new Float32Array(vertices),normals=new Float32Array(normalValues),indices=new Uint32Array(triangles);
    // Mesh sharing remains independent of appearance and placement.
    const data=encodeScene({parts:[{id:'surface',name:'surface',color:'#ffffff',positions,normals,indices}]}),digest=hash(Buffer.from(data)),asset='surface-'+digest;
    writes.set(digest,data);appearance.catalog[asset]={mesh:'appearance/'+digest+'.bin',meshSha256:digest};
    parts.push({asset,color});
   }
   appearance.instances[id]={parts};
  }
 }
 node.children?.forEach((child,i)=>walk(child,id+'/'+i,matrix));
}
gltf.scenes[gltf.scene??0].nodes.forEach((node,i)=>walk(node,'step:'+i,identity()));
if(Object.keys(appearance.instances).length!==expected.size)throw Error('Presentation occurrence count mismatch');
const presentationFile=Bun.file(path.join(root,'presentation.json'));
if(await presentationFile.exists()){
 const presentation=await presentationFile.json();
 if(presentation.schema!==1||presentation.sourceHash!==assembly.sourceHash)throw Error('Stale presentation overrides');
 for(const [id,offset] of Object.entries(presentation.offsets)){
  if(!appearance.instances[id]||!Array.isArray(offset)||offset.length!==3||!offset.every(Number.isFinite))throw Error('Invalid presentation offset '+id);
  appearance.instances[id].offset=offset;
 }
}
await mkdir(path.join(root,'appearance'),{recursive:true});
for(const [digest,data] of writes)await Bun.write(path.join(root,'appearance',digest+'.bin'),data);
await Bun.write(path.join(root,'appearance.json'),JSON.stringify(appearance));
console.log(JSON.stringify({occurrences:expected.size,multicolor:Object.values(appearance.instances).filter(x=>x.parts).length,surfaceMeshes:writes.size,surfaceMeshBytes:[...writes.values()].reduce((s,b)=>s+b.byteLength,0),colors:[...new Set(Object.values(appearance.instances).flatMap(x=>x.parts?x.parts.map(p=>p.color):[x.color]))].length}));
