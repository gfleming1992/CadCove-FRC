import {test,expect} from 'bun:test';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {compileMechanism} from '../lib/mechanism-export.js';
const fixture=()=>JSON.parse(readFileSync(new URL('../examples/rotary-mechanism/cad/mechanism.json',import.meta.url),'utf8'));
const compile=m=>compileMechanism(m,m.bodies.flatMap(b=>b.parts));
test('CAD joint frames, ratios and motor bindings compile into SI physics without inference',()=>{
 const {world,bindings}=compile(fixture());
 expect(world.bodies.length).toBe(5);expect(world.joints.length).toBe(4);
 expect(world.transmissions.map(t=>t.ratio)).toEqual([-.5,.5,.5]);
 expect(world.bodies[2].position).toEqual([.06,0,0]);
 expect(world.joints[1].anchor_parent).toEqual([-.005,-.045,.008]);
 expect(world.motors[0].joint).toBe('motor-shaft-axis');
 expect(bindings['drive-pulley'].body).toBe(bindings['output-gear'].body);
 expect(bindings['drive-pulley'].local[3]).toBe(-.06);
 expect(world.bodies[1].principal_inertia[0]).toBeCloseTo(fixture().bodies[1].physics.principalInertiaKgMm2[0]*1e-6,10);
});
test('missing physical inputs fail rather than guessing mass or coupling stiffness',()=>{
 const m=fixture();delete m.bodies[1].physics;expect(()=>compile(m)).toThrow('Explicit mass');
 const n=fixture();delete n.relations[0].physics;expect(()=>compile(n)).toThrow('compliance');
 const p=fixture();delete p.motors[0].physics;expect(()=>compile(p)).toThrow('electrical');
});
const binary=fileURLToPath(new URL('../target/distribution/release/instantcad-sim'+(process.platform==='win32'?'.exe':''),import.meta.url));
test.skipIf(!existsSync(binary))('exported world loads and its motor drives all three native transmissions',async()=>{
 const {world}=compile(fixture());
 const child=Bun.spawn([binary],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
 child.stdin.write(JSON.stringify({op:'load',world})+'\n');
 child.stdin.write(JSON.stringify({op:'step',steps:200,volts:{'demo-motor':1}})+'\n');child.stdin.end();
 const [text,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 expect(code).toBe(0);const replies=text.trim().split('\n').map(JSON.parse);for(const r of replies)expect(r.ok).toBe(true);
 const state=replies.at(-1).state??replies.at(-1);
 const joints=state.joints;expect(joints).toBeDefined();
 expect(joints['motor-shaft-axis'].position).toBeGreaterThan(.01);
 for(const t of world.transmissions){expect(Math.abs(joints[t.follower].position-t.ratio*joints[t.driver].position)).toBeLessThan(.03);}
},30000);

test.skipIf(!existsSync(binary))('one nested definition produces matching CAD and native physics poses',async()=>{
 const {validateMechanism,mechanismPose}=await import('../vendor/cad-core/src/core/mechanism.js');
 const {quaternionMatrix,compose,translation,point}=await import('../lib/transforms.js');
 const p={massKg:1,centerOfMassMm:[0,0,0],principalInertiaKgMm2:[1000,1000,1000],friction:0,colliders:[{kind:'box',halfMm:[2,2,2],centerMm:[0,0,0]}],provenance:'Synthetic nested joint regression, not robot calibration'};
 const electrical=fixture().motors[0].physics;
 const m={schema:1,units:'mm-deg',bodies:[{id:'chassis',fixed:true,origin:[10,0,0],parts:['base'],physics:p},{id:'module',fixed:false,origin:[30,0,0],parts:['fork'],physics:p},{id:'wheel',fixed:false,origin:[50,0,0],parts:['tire'],physics:p}],joints:[{id:'spin',parent:'module',child:'wheel',type:'revolute',origin:[50,0,0],axis:[0,1,0],bindAngleDeg:17,damping:.001},{id:'steer',parent:'chassis',child:'module',type:'revolute',origin:[30,0,0],axis:[0,0,1],bindAngleDeg:31,damping:.001}],relations:[],motors:[{id:'steer-motor',joint:'steer',physics:electrical},{id:'spin-motor',joint:'spin',physics:electrical}]};
 const {world}=compile(m),child=Bun.spawn([binary],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
 child.stdin.write(JSON.stringify({op:'load',world})+'\n');child.stdin.write(JSON.stringify({op:'step',steps:40,volts:{'steer-motor':.2,'spin-motor':.2}})+'\n');child.stdin.end();
 const text=await new Response(child.stdout).text();expect(await child.exited).toBe(0);const replies=text.trim().split('\n').map(JSON.parse);for(const r of replies)expect(r.ok).toBe(true);
 const state=replies.at(-1).state??replies.at(-1),angles=Object.fromEntries(Object.entries(state.joints).map(([id,j])=>[id,j.position*180/Math.PI]));
 const pose=mechanismPose(validateMechanism(m),'spin',angles.spin,angles);
 expect(Math.abs(angles.steer-31)).toBeGreaterThan(.1);expect(Math.abs(angles.spin-17)).toBeGreaterThan(.1);
 for(const b of m.bodies){const stateBody=state.bodies[b.id],physics=compose(quaternionMatrix(stateBody.quaternion,stateBody.position),translation(b.origin.map(v=>-v/1000)));for(const sample of [[0,0,0],[20,30,10]]){
  const cadPoint=point(pose.transforms[b.parts[0]],sample).map(v=>v/1000),physicsPoint=point(physics,sample.map(v=>v/1000));
  cadPoint.forEach((v,i)=>expect(Math.abs(v-physicsPoint[i])).toBeLessThan(.0002));
 }}
},30000);

test('no-contact commissioning requires explicit intent and validates collision groups',()=>{
 const m=fixture();m.bodies[1].physics.colliders=[];expect(()=>compile(m)).toThrow('Explicit mass');
 m.bodies[1].physics.collisionModel='none';m.bodies[1].physics.membership=1;m.bodies[1].physics.filter=6;
 const b=compile(m).world.bodies[1];expect(b.colliders).toEqual([]);expect(b.membership).toBe(1);expect(b.filter).toBe(6);
 m.bodies[1].physics.filter=-1;expect(()=>compile(m)).toThrow('collision group');
});
