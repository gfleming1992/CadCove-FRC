// Rebuild FIRST-owned geometry locally from the pinned official STEP download.
// Only occurrence identity and collision-source recipes are shipped in Git.
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {OcctKernel} from 'occt-wasm';
import * as brepjs from 'brepjs';
import {encodeScene} from '../vendor/cad-core/src/core/mesh.js';
const [source,output]=process.argv.slice(2);
if(!source||!output||process.argv.length!==4)throw Error('Usage: bun scripts/build-example-field.js FIELD_STEP OUTPUT');
const repo=path.resolve(import.meta.dir,'..'),root=path.resolve(output);
const pin=JSON.parse(await readFile(path.join(repo,'examples/team3310-rebuilt/field-source.json')));
const hash=b=>createHash('sha256').update(b).digest('hex'),bytes=await readFile(source);
if(bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('Unexpected REBUILT field revision; refusing mismatched occurrence bindings');
const expected=new Map(pin.occurrences.map(n=>[n.id,n])),catalog={},flat=[],prototypes=new Map();
await mkdir(path.join(root,'components'),{recursive:true});await mkdir(path.join(root,'meshes'),{recursive:true});
const kernel=await OcctKernel.init({wasm:await readFile(path.join(repo,'node_modules/occt-wasm/dist/occt-wasm.wasm'))});
const adapter=brepjs.OcctWasmAdapter.fromKernel(kernel);brepjs.registerKernel('occt-wasm',adapter);
const doc=kernel.importXCAFFromSTEP(bytes.toString());
const identity=[1,0,0,0,0,1,0,0,0,0,1,0];
const compose=(a,b)=>{const c=Array(12).fill(0);for(let r=0;r<3;r++)for(let j=0;j<4;j++){for(let k=0;k<3;k++)c[r*4+j]+=a[r*4+k]*b[k*4+j];if(j===3)c[r*4+j]+=a[r*4+3];}return c;};
const color=c=>'#'+c.map(v=>Math.round(255*Math.max(0,Math.min(1,v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055))).toString(16).padStart(2,'0')).join('');
async function walk(label,id,parent,inherited){
 const occurrence=doc.getLabelInfo(label),prototype=doc.getReferredLabel(label),info=prototype===null?occurrence:doc.getLabelInfo(prototype);
 const node={id:'step:'+id,name:info.name||occurrence.name||'part-'+id,transform:doc.getLocation(label)};
 const world=compose(parent,node.transform),rgb=occurrence.hasColor?occurrence.color:info.hasColor?info.color:inherited;
 try{
  const children=doc.getChildren(prototype??label);
  if(children.length){node.children=[];for(let i=0;i<children.length;i++){const n=await walk(children[i],id+'/'+i,world,rgb);if(n)node.children.push(n);}return node;}
  if(info.shapeHandle===null)return null;
  const ref=expected.get(node.id);if(!ref||ref.name!==node.name)throw Error('Field occurrence mismatch: '+node.id);
  const key=String(prototype??label);let asset=prototypes.get(key);
  if(!asset){
   asset=ref.asset;
   let shape=brepjs.castShape(adapter.downcast(info.shapeHandle,kernel.getShapeType(info.shapeHandle).toLowerCase()));
   if(!adapter.isValid(shape.wrapped))shape=brepjs.unwrap(brepjs.fixShape(shape));
   const step=kernel.exportStep(shape.wrapped.id),mesh=adapter.mesh(shape.wrapped,{tolerance:1,angularTolerance:.4});
   const positions=new Float32Array(mesh.vertices),normals=new Float32Array(mesh.normals),indices=new Uint32Array(mesh.triangles);
   const metrics={valid:adapter.isValid(shape.wrapped),volume:kernel.getVolume(shape.wrapped.id),bounds:adapter.boundingBox(shape.wrapped),triangles:indices.length/3};
   const data=Buffer.from(encodeScene({parts:[{id:asset,name:node.name,color:color(rgb??[.5,.5,.5]),positions,normals,indices,metrics}]}));
   await writeFile(path.join(root,'components',asset+'.step'),step);await writeFile(path.join(root,'meshes',asset+'.bin'),data);
   catalog[asset]={name:node.name,file:'components/'+asset+'.step',sha256:hash(step),bytes:Buffer.byteLength(step),mesh:'meshes/'+asset+'.bin',meshSha256:hash(data),meshBytes:data.length,centerOfMass:kernel.getCenterOfMass(shape.wrapped.id),unitDensityInertia:kernel.getInertia(shape.wrapped.id),...metrics};
   prototypes.set(key,asset);if(prototypes.size%50===0)console.error('Field components: '+prototypes.size);
  }
  if(asset!==ref.asset)throw Error('Field prototype mismatch');
  node.asset=asset;node.color=color(rgb??[.5,.5,.5]);flat.push({...node,transform:world});return node;
 }finally{if(occurrence.shapeHandle!==null)kernel.release(occurrence.shapeHandle);if(info!==occurrence&&info.shapeHandle!==null)kernel.release(info.shapeHandle);}
}
try{
 const children=[];for(const [i,label] of doc.getRoots().entries())children.push(await walk(label,String(i),identity,null));
 if(flat.length!==expected.size)throw Error('Field occurrence count mismatch');
 for(const [file,value] of Object.entries({'assembly.json':{schema:1,id:'field',units:'mm',sourceHash:pin.sha256,children},'catalog.json':catalog,'instances.json':flat}))await writeFile(path.join(root,file),JSON.stringify(value,null,2)+'\n');
 await writeFile(path.join(root,'catalog.js'),'export default '+JSON.stringify(catalog)+';\n');await writeFile(path.join(root,'instances.js'),'export default '+JSON.stringify(flat)+';\n');
 await writeFile(path.join(root,'model.js'),await readFile(path.join(repo,'scripts/component-model.js')));
 console.log(JSON.stringify({occurrences:flat.length,prototypes:prototypes.size}));
}finally{doc.close();kernel[Symbol.dispose]();}
