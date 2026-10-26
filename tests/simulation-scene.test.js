import {test,expect} from 'bun:test';
import {loadAssembly,bindSimulationScene,bindPersistentScene,poseTransforms,assetURL,digest,selectSimulationBodies} from '../web/simulation-scene.js';
import {encodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {identity,translation} from '../lib/transforms.js';
async function fixture(){
 const bytes=encodeScene({parts:[{id:'p',name:'plate',color:'#dd4400',positions:new Float32Array([0,0,0,1000,0,0,0,1000,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])}]}),hash=await digest(bytes);
 const catalog={p:{mesh:'meshes/plate.bin',meshSha256:hash}},instances=[{id:'plate',asset:'p',transform:translation([1000,0,0]),color:'#dd4400'}];
 let appearance={schema:1,instancesHash:await digest(new TextEncoder().encode(JSON.stringify(instances))),catalog:{},instances:{plate:{color:'#1122ff',opacity:.2}}};
 let mesh=bytes;const fetcher=async url=>url.endsWith('catalog.json')?Response.json(catalog):url.endsWith('instances.json')?Response.json(instances):url.endsWith('appearance.json')?Response.json(appearance):new Response(mesh);
 return {catalog,instances,fetcher,appearance,corrupt:()=>{mesh=new Uint8Array(bytes.byteLength);}};
}
test('shared scene loader checks mesh digests and CAD appearance then converts mm to metres once',async()=>{
 const f=await fixture(),robot=await loadAssembly('robot','https://assets/robot',{fetcher:f.fetcher}),field={prototypes:[],instances:[]};
 expect(robot.instances[0].opacity).toBe(.2);expect(robot.instances[0].color).toBe('#1122ff');expect(robot.instances[0].matrix[3]).toBe(1);
 const scene=bindSimulationScene(robot,field,{schema:1,robot:{plate:{body:'chassis',local:identity()}},field:{},start:[2,0,0],fieldOrigin:[0,0,0]});
 expect(scene.instances[0].transform[0]).toBe(.001);expect(scene.instances[0].transform[3]).toBe(3);
 const transforms=poseTransforms(scene.instances,{bodies:{chassis:{position:[4,5,6],quaternion:[0,0,0,1]}}});expect(transforms['robot/plate']).toEqual([.001,0,0,4,0,.001,0,5,0,0,.001,6]);
 f.corrupt();await expect(loadAssembly('robot','https://assets/robot',{fetcher:f.fetcher})).rejects.toThrow('integrity');
});
test('stale color bindings and unsafe asset paths fail closed',async()=>{
 const f=await fixture();f.appearance.instancesHash='0'.repeat(64);await expect(loadAssembly('robot','https://assets/robot',{fetcher:f.fetcher})).rejects.toThrow('Stale');
 for(const p of ['../secret','a/../b','/etc/passwd','a\\b','https://evil','a?query'])expect(()=>assetURL('https://local',p)).toThrow();
 expect(assetURL('https://local','meshes/my plate.bin')).toBe('https://local/meshes/my%20plate.bin');
});

test('rotated moving field parts preserve the CAD bind pose and follow the physical body',()=>{
 const empty={prototypes:[],instances:[]};
 const field={prototypes:[],instances:[{id:'field/gate',sourceId:'gate',matrix:[0,-1,0,7,1,0,0,16.5,0,0,1,1.2]}]};
 const scene=bindSimulationScene(empty,field,{schema:1,start:[0,0,0],fieldOrigin:[3,4,0],robot:{},field:{gate:{body:'gate-body',local:translation([.5,0,.2])}}});
 const bind=poseTransforms(scene.instances,{bodies:{'gate-body':{position:[10,20,1],quaternion:[0,0,Math.SQRT1_2,Math.SQRT1_2]}}})['field/gate'];
 bind.forEach((v,i)=>expect(v).toBeCloseTo(scene.instances[0].transform[i],9));
 const moved=poseTransforms(scene.instances,{bodies:{'gate-body':{position:[11,19,2],quaternion:[0,0,1,0]}}})['field/gate'];
 [-.001,0,0,10.5,0,-.001,0,19,0,0,.001,2.2].forEach((v,i)=>expect(moved[i]).toBeCloseTo(v,9));
});

test('existing translation-only field bindings retain their placement and orientation',()=>{
 const field={prototypes:[],instances:[{id:'field/gate',sourceId:'gate',matrix:[0,-1,0,7,1,0,0,16.5,0,0,1,1.2]}]};
 const scene=bindSimulationScene({prototypes:[],instances:[]},field,{schema:1,start:[0,0,0],fieldOrigin:[3,4,0],robot:{},field:{gate:{body:'gate-body',bindPosition:[7,16,1]}}});
 const bind=poseTransforms(scene.instances,{bodies:{'gate-body':{position:[10,20,1],quaternion:[0,0,0,1]}}})['field/gate'];
 bind.forEach((v,i)=>expect(v).toBeCloseTo(scene.instances[0].transform[i],9));
});

test('viewer refuses malformed, scaled, mirrored and ambiguous bindings before use',()=>{
 const base={schema:1,start:[0,0,0],fieldOrigin:[0,0,0],robot:{part:{body:'chassis',local:identity()}},field:{}};
 for(const local of [null,[],Array(16).fill(0),[1000,0,0,0,0,1,0,0,0,0,1,0],[-1,0,0,0,0,1,0,0,0,0,1,0],[1,.2,0,0,0,1,0,0,0,0,1,0],[1,0,0,Infinity,0,1,0,0,0,0,1,0]]){
  const bindings=structuredClone(base);bindings.robot.part.local=local;
  expect(()=>bindSimulationScene({prototypes:[],instances:[]},{prototypes:[],instances:[]},bindings)).toThrow('local');
 }
 const bindings=structuredClone(base);bindings.field.gate={body:'gate-body',local:identity(),bindPosition:[0,0,0]};
 expect(()=>bindSimulationScene({prototypes:[],instances:[]},{prototypes:[],instances:[]},bindings)).toThrow('not both');
});

test('appearance opacity is preserved for split surfaces and invalid alpha fails',async()=>{
 const f=await fixture();
 f.appearance.instances.plate={parts:[{asset:'p',color:'#aaaaaa',opacity:.15},{asset:'p',color:'#000000',opacity:.5}]};
 const field=await loadAssembly('field','https://assets/field',{fetcher:f.fetcher});
 expect(field.instances.map(n=>n.opacity)).toEqual([.15,.5]);
 f.appearance.instances.plate.parts[0].opacity=2;
 await expect(loadAssembly('field','https://assets/field',{fetcher:f.fetcher})).rejects.toThrow('opacity');
});

test('single material render mesh replaces coarse prototype without changing source occurrence',async()=>{
 const f=await fixture();f.appearance.catalog.fine={...f.catalog.p};f.appearance.instances.plate.asset='fine';
 const scene=await loadAssembly('field','https://assets/field',{fetcher:f.fetcher});
 expect(scene.instances[0].id).toBe('field/plate');expect(scene.instances[0].sourceId).toBe('plate');expect(scene.instances[0].asset).toBe('field/fine');expect(scene.prototypes[0].id).toBe('field/fine');
});

test('subsystem presentation isolates exact physical bodies and restores all without mutating scene',()=>{
 const instances=[{id:'a',body:'wheel',opacity:.4},{id:'b',body:'wheel'},{id:'ball',body:'fuel'},{id:'wall'}];
 const before=JSON.stringify(instances);
 expect(selectSimulationBodies(instances,['wheel','fuel']).map(n=>n.id)).toEqual(['a','b','ball']);
 expect(selectSimulationBodies(instances,null)).toBe(instances);
 for(const bad of [[],['missing'],['wheel','missing'],'wheel'])expect(()=>selectSimulationBodies(instances,bad)).toThrow();
 expect(JSON.stringify(instances)).toBe(before);
});

test('persistent binding removes baked native occurrence frames and keeps IDs and source data',()=>{
 const frame=[0,-1,0,1000,1,0,0,2000,0,0,1,3000];
 const local=[0,-1,0,1,1,0,0,2,0,0,1,3];
 const robot={instances:[{id:'part',asset:'part',transform:identity()}]},field={instances:[]},physical={instances:[],bindings:[]};
 const bindings={schema:1,start:[0,0,0],fieldOrigin:[0,0,0],robot:{part:{body:'chassis',local}},field:{}};
 const before=JSON.stringify({robot,bindings});
 const scene=bindPersistentScene({robot,field,physical,nativeFrames:{part:frame}},bindings);
 expect(scene.instances[0].id).toBe('part');expect(scene.instances[0].local).toEqual(identity());
 expect(poseTransforms(scene.instances,{bodies:{chassis:{position:[4,5,6],quaternion:[0,0,0,1]}}}).part).toEqual([.001,0,0,4,0,.001,0,5,0,0,.001,6]);
 expect(JSON.stringify({robot,bindings})).toBe(before);
 expect(()=>bindPersistentScene({robot,field,physical,nativeFrames:{}},bindings)).toThrow('Missing native');
 expect(()=>bindPersistentScene({robot,field,physical,nativeFrames:{part:Array(12).fill(0)}},bindings)).toThrow('rotation');
 expect(()=>bindPersistentScene({robot:{instances:[]},field,physical},bindings)).toThrow('missing from CAD');
});

test('persistent imported split surfaces, moving field and physical proxies share pose bindings',()=>{
 const robot={instances:[0,1].map(i=>({id:'robot/part/surface/'+i,sourceId:'part',opacity:.3,transform:identity()}))};
 const field={instances:[{id:'field/gate',sourceId:'gate',matrix:translation([1,2,3])}]};
 const physical={instances:[{id:'physics/ball/0'}],bindings:[{id:'physics/ball/0',body:'ball',local:identity()}]};
 const bindings={schema:1,start:[0,0,0],fieldOrigin:[10,0,0],robot:{part:{body:'chassis',local:identity()}},field:{gate:{body:'gate',bindPosition:[1,2,3]}}};
 const before=JSON.stringify({robot,field,physical});
 const scene=bindPersistentScene({robot,field,physical},bindings,['chassis','gate','ball']);
 expect(scene.instances.map(n=>n.id)).toEqual(['robot/part/surface/0','robot/part/surface/1','field/gate','physics/ball/0']);
 expect(scene.instances[2].transform[3]).toBe(11);expect(scene.instances[2].local).toEqual(identity());
 const transforms=poseTransforms(scene.instances,{bodies:Object.fromEntries(['chassis','gate','ball'].map(id=>[id,{position:[2,3,4],quaternion:[0,0,0,1]}]))});
 expect(Object.keys(transforms)).toHaveLength(4);expect(transforms['physics/ball/0'][11]).toBe(4);
 expect(JSON.stringify({robot,field,physical})).toBe(before);
});
