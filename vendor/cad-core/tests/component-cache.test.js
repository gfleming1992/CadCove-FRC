import {test,expect} from 'bun:test';
import {ComponentCache,dependencyHashes} from '../src/core/component-cache.js';
import {collect} from '../src/core/geometry.js';
import {encodeScene,decodeScene} from '../src/core/mesh.js';
import {Viewer} from '../src/core/viewer.js';
import {OcctKernel} from 'occt-wasm';
import * as brepjs from 'brepjs';

test('registry selection changes invalidate caches without expanding unrelated import closures',async()=>{
 const files={'registry.js':'export {default as a} from "./a.js"','a.js':'export default()=>1'};
 const a=await dependencyHashes(files,'1'),b=await dependencyHashes({...files,'a.js':'export default()=>2'},'2');
 expect(await a('registry.js')).not.toBe(await b('registry.js'));
 expect(await a({path:'registry.js',transitive:false})).toBe(await b({path:'registry.js',transitive:false}));
 const c=await dependencyHashes({...files,'registry.js':'export {default as b} from "./a.js"'},'3');
 expect(await a({path:'registry.js',transitive:false})).not.toBe(await c({path:'registry.js',transitive:false}));
 const tx=await new ComponentCache().begin({files,entry:'a.js',revision:'1'});
 await expect(tx.part({id:'a',dependencies:[],inputs:{bad:NaN}},()=>{})).rejects.toThrow('finite JSON');
});

test('component cache invalidates dependencies/placements, preserves accepted meshes on failure, and seeds disk reloads',async()=>{
 const kernel=await OcctKernel.init({wasm:await Bun.file('node_modules/occt-wasm/dist/occt-wasm.wasm').arrayBuffer()});
 const adapter=brepjs.OcctWasmAdapter.fromKernel(kernel);brepjs.registerKernel('occt-wasm',adapter);
 const wrap=id=>brepjs.castShape(adapter.downcast(id,kernel.getShapeType(id).toLowerCase()));
 const cache=new ComponentCache(),files={'model.js':'export default()=>{}','a.js':'export {x} from "./helper.js"','helper.js':'export const x=1','b.js':'export default()=>2'};
 let built=0;
 const factory=()=>{built++;return wrap(kernel.makeBox(2,3,4));};
 const spec=(id,inputs={})=>({id,dependencies:[`${id}.js`],inputs,color:'#ff0000'});
 const begin=(revision='1',source=files)=>cache.begin({files:source,entry:'model.js',revision});
 try{
  let tx=await begin(),a=await tx.part(spec('a'),factory),b=await tx.part(spec('b'),factory);
  const first=collect([a,b],adapter,null,null,tx);tx.commit();expect(built).toBe(2);
  tx=await begin('2',{...files,'helper.js':'export const x=2'});
  a=await tx.part(spec('a'),factory);b=await tx.part({...spec('b'),name:'Renamed',color:'#0000ff'},factory);
  const next=collect([a,b],adapter,null,null,tx);tx.commit();expect(built).toBe(3);
  expect(next[1].positions).toBe(first[1].positions);expect(next[1].color).toBe('#0000ff');expect(tx.stats.hits).toBe(1);
  const exact=await tx.record(b).resolve();expect(adapter.volume(exact.wrapped)).toBeCloseTo(24);expect(built).toBe(4);
  const accepted=cache.entries;
  tx=await begin('3');await expect(tx.part(spec('a',{changed:true}),()=>{throw Error('bad edit');})).rejects.toThrow('bad edit');
  expect(cache.entries).toBe(accepted);
  tx=await begin('4');a=await tx.part(spec('a',{placement:[1,2,3]}),factory);collect([a],adapter,null,null,tx);tx.commit();
  expect(tx.stats.hits).toBe(0);expect(cache.entries.size).toBe(1); // removed parts/older revisions are dropped
  const scene=decodeScene(encodeScene({parts:next})),restored=new ComponentCache();restored.seed(scene.parts);
  tx=await restored.begin({files:{...files,'helper.js':'export const x=2'},entry:'model.js',revision:'2'});
  a=await tx.part(spec('a'),factory);b=await tx.part(spec('b'),factory);
  expect(tx.stats.hits).toBe(2);expect(collect([a,b],adapter,null,null,tx)[0].positions).toBe(scene.parts[0].positions);
  const bounded=new ComponentCache(1);bounded.seed(scene.parts);expect(bounded.entries.size).toBe(0);
 }finally{kernel[Symbol.dispose]();}
});

test('GPU hot swap preserves live camera, reuses other buckets, and keeps old buffers on preparation failure',()=>{
 globalThis.GPUBufferUsage={VERTEX:1,INDEX:2,COPY_DST:4};
 const viewer=Object.create(Viewer.prototype),buffers=[];
 viewer.camera={target:[17,-4,9],distance:110,yaw:2.6,pitch:0.7};viewer.request=()=>{};
 viewer.device={createBuffer:()=>{const b={destroyed:false,destroy(){this.destroyed=true;}};buffers.push(b);return b;},queue:{writeBuffer(){}}};
 const part=(id,n=0)=>({id,color:'#ff0000',positions:new Float32Array([n,0,0,n+1,0,0,n,1,0]),normals:new Float32Array(9).fill(1),indices:new Uint32Array([0,1,2])});
 const scene={parts:Array.from({length:128},(_,i)=>part(`part-${i}`,i))};viewer.setScene(scene);
 const before=structuredClone(viewer.camera),old=[...viewer.batches];
 const replacement={parts:scene.parts.map((p,i)=>i===5?part(p.id,1000):p)};viewer.setScene(replacement);
 expect(viewer.camera).toEqual(before);expect(viewer.lastUpload.rebuiltBatches).toBe(1);expect(viewer.lastUpload.reusedBatches).toBe(31);
 expect(viewer.batches.filter((b,i)=>b===old[i]).length).toBe(31);
 const accepted=viewer.batches;viewer.device.queue.writeBuffer=()=>{throw Error('GPU upload failed');};
 expect(()=>viewer.setScene({parts:[part('new')]})).toThrow('GPU upload failed');
 expect(viewer.batches).toBe(accepted);expect(viewer.camera).toEqual(before);expect(viewer.scene).toBe(replacement);
});
