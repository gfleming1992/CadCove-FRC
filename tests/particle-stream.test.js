import {test,expect} from 'bun:test';
import {existsSync} from 'node:fs';
import {NativeParticleStream,compliantSphereTopology} from '../lib/particle-stream.js';
import {MechanismSession} from '../lib/mechanism-session.js';
const binary=new URL('../target/distribution/release/instantcad-sim'+(process.platform==='win32'?'.exe':''),import.meta.url).pathname;
export const softWorld=()=>({dt:.005,gravity:[0,0,-9.81],bodies:[{id:'floor',fixed:true,position:[0,0,-.1],mass:1,colliders:[{kind:'box',half:[1,1,.1],center:[0,0,0]}]},{id:'ball',position:[0,0,.18],mass:.215,colliders:[{kind:'ball',radius:.075,center:[0,0,0]}],compliance:{frequency_hz:120,subdivisions:1,entry_margin:.03,exit_margin:.1,recovery_tolerance:.0005}}],joints:[],motors:[],transmissions:[],compliance_zones:[{body:'floor',center:[0,0,.3],half:[.5,.5,.5],lookahead:.03}]});
test('particle topology matches supported native counts; opt in is bounded and explicit',()=>{
 expect([0,1,2].map(n=>compliantSphereTopology(n).particleCount)).toEqual([13,43,163]);const stream=new NativeParticleStream();expect(()=>stream.configure(softWorld(),{bodyIds:['floor'],revision:'r'})).toThrow('no native compliant');expect(()=>stream.configure(softWorld(),{bodyIds:['ball'],revision:'r',maxHz:31})).toThrow('1–30');expect(()=>stream.configure(softWorld(),{bodyIds:['ball','ball'],revision:'r'})).toThrow('unique');
});
test('sparse rate limiting, topology caching and pending-reset cancellation',async()=>{
 const s=new NativeParticleStream(),c=s.configure(softWorld(),{bodyIds:['ball'],revision:'r',maxHz:20});const state={tick:4,time:.02,bodies:{ball:{}},compliance:{bodies:{ball:{}}}},points=Array.from({length:43},()=>[0,0,0]);let calls=0;const request=async()=>{calls++;return {points};};const first=await s.sample(state,request,100);expect(first.topologies).toEqual(c.topologies);expect(await s.sample({...state,tick:8},request,120)).toBeUndefined();expect((await s.sample({...state,tick:12},request,150)).topologies).toBeUndefined();expect(calls).toBe(2);const rigid=await s.sample({...state,tick:14,compliance:{bodies:{}}},request,200);expect(rigid.bodies.ball.representation).toBe('rigid');expect(calls).toBe(2);
 let release;const pending=s.sample({...state,tick:16},()=>new Promise(r=>release=r),250);s.reset();release({points});expect(await pending).toBeUndefined();expect(await s.sample(state,request,300)).toBeUndefined();
});
test.skipIf(!existsSync(binary))('real native session emits authoritative soft points without extra step or requests after pause/dispose',async()=>{
 const packets=[],errors=[],session=new MechanismSession(binary,{onState:s=>{if(s.deformation)packets.push(s);},onError:e=>errors.push(e.message)});
 try{
  await session.startWorld(softWorld());const descriptor=session.configureParticles({bodyIds:['ball'],maxHz:20,revision:'fixture-physics'});session.resume();await new Promise(r=>setTimeout(r,300));session.pause();await new Promise(r=>setTimeout(r,60));const count=packets.length;await new Promise(r=>setTimeout(r,100));expect(packets.length).toBe(count);expect(count).toBeGreaterThan(1);expect(count).toBeLessThanOrEqual(7);expect(errors).toEqual([]);
  for(const p of packets){expect(p.deformation.streamId).toBe(descriptor.streamId);expect(p.deformation.tick).toBe((p.state??p).tick);expect(p.deformation.bodies.ball.particles.length).toBe(43);expect(p.deformation.bodies.ball.particles.flat().every(Number.isFinite)).toBe(true);}
  expect(packets[0].deformation.topologies).toBeDefined();expect(packets.slice(1).every(p=>p.deformation.topologies===undefined)).toBe(true);session.disableParticles();expect(session.particleStream.config).toBeNull();
 }finally{session.close();}expect(session.particleStream.config).toBeNull();
});
