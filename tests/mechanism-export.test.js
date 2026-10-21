import {test,expect} from 'bun:test';
import {readFileSync,existsSync} from 'node:fs';
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
const binary=new URL('../target/distribution/release/instantcad-sim',import.meta.url).pathname;
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
