import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createInterface} from 'node:readline';
import {composeMatchWorld} from '../lib/match-world.js';
import {startMatch,MatchPacing} from '../lib/match-coordinator.js';
const fixture=()=>({bodies:[{id:'chassis',position:[1,0,0],membership:1,filter:6},{id:'wheel',position:[2,0,0],velocity:[1,0,0],membership:1,filter:6},{id:'ball',position:[0,0,0],membership:4,filter:7},{id:'field',position:[0,0,0],membership:2,filter:5}],joints:[{id:'shaft',parent:'chassis',child:'wheel'}],motors:[{id:'motor',joint:'shaft'}],transmissions:[],gameplay:{carrier:'chassis',balls:['ball'],intake_motor:'motor',field_conveyors:[{id:'conveyor'}]},field_drives:{},compliance_zones:[{body:'chassis'}]});
const compose=s=>composeMatchWorld(s,{robotBodyIds:['chassis','wheel'],spawns:[{position:[0,0,0]},{position:[10,0,0],yaw:Math.PI}]});
test('shared field keeps one ball pool, rotates robot poses, and permits only cross-robot contacts',()=>{
 const source=fixture(),before=structuredClone(source),{world:w,robots}=compose(source);
 expect(source).toEqual(before);expect(w.bodies.length).toBe(6);expect(w.bodies.filter(b=>b.id==='ball')).toHaveLength(1);
 const a=w.bodies.find(b=>b.id==='r0/chassis'),b=w.bodies.find(b=>b.id==='r1/chassis'),wheel=w.bodies.find(b=>b.id==='r1/wheel');
 expect(a.membership&b.filter).not.toBe(0);expect(b.membership&a.filter).not.toBe(0);expect(a.membership&a.filter).toBe(0);
 expect(wheel.position[0]).toBeCloseTo(9);expect(wheel.velocity[0]).toBeCloseTo(-1);
 expect(w.robot_gameplay.r1.intake_motor).toBe('r1/motor');expect(w.robot_gameplay.r1.balls).toEqual(['ball']);expect(w.robot_gameplay.r1.field_conveyors).toEqual([]);
 expect(robots[1].world.bodies.find(b=>b.id==='chassis').position).toEqual([10,0,0]);
});
test('composer rejects field connections and malformed placements',()=>{
 const s=fixture();s.joints.push({id:'bad',parent:'wheel',child:'field'});expect(()=>compose(s)).toThrow('jointed');
 expect(()=>composeMatchWorld(fixture(),{robotBodyIds:['chassis','wheel'],spawns:[{position:[NaN,0,0]},{position:[0,0,0]}]})).toThrow('spawn');
});
async function connect(match,r,token=match.token,coordinatorPacing=true){
 const socket=net.connect(match.port,'127.0.0.1');await new Promise((ok,no)=>{socket.once('connect',ok);socket.once('error',no);});
 const lines=createInterface({input:socket})[Symbol.asyncIterator]();
 const call=async x=>{socket.write(JSON.stringify(x)+'\n');const line=await lines.next();if(line.done)throw Error('closed');return JSON.parse(line.value);};
 return {socket,call,joined:await call({op:'join',robotId:r.id,token,coordinatorPacing})};
}
test('coordinator advances one shared tick only after both programs submit, isolates actuator IDs, rejects outsiders',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cadcove-match-'));let match;const clients=[];
 try{
  const binary=path.join(dir,'physics.mjs');await writeFile(binary,`#!${process.execPath}\nimport {createInterface} from 'node:readline';let tick=0,w;for await(const line of createInterface({input:process.stdin})){const c=JSON.parse(line);if(c.op==='load')w=c.world;if(c.op==='step')tick++;console.log(JSON.stringify({ok:true,state:{tick,time:tick*.005,bodies:Object.fromEntries(w.bodies.map(b=>[b.id,{position:b.position}])),joints:{},motors:c.volts||{},contacts:[],gameplay:{captured:tick},robot_gameplay:{r1:{captured:tick+10}}}}));}`,{mode:0o700});
  let stepped;const source=fixture();source.dt=.04;const config=compose(source);match=await startMatch({binary:process.execPath,binaryArgs:[binary],...config,onStep:()=>stepped?.()});
  const outsider=await connect(match,config.robots[0],'wrong');clients.push(outsider);expect(outsider.joined.ok).toBe(false);expect(match.failure).toBeNull();
  const legacy=await connect(match,config.robots[0],match.token,false);expect(legacy.joined.ok).toBe(false);expect(legacy.joined.error).toContain('re-export');legacy.socket.destroy();
  for(const r of config.robots){const c=await connect(match,r);clients.push(c);expect(c.joined.ok).toBe(true);expect(c.joined.pacing).toBe('coordinator');expect((await c.call({op:'load',world:r.world})).ok).toBe(true);}
  const [a,b]=clients.slice(1);let finished=false;const first=a.call({op:'step',volts:{motor:4}}).then(r=>{finished=true;return r;});
  await Bun.sleep(30);expect(finished).toBe(false);expect(match.snapshot.tick).toBe(0);
  const ready=performance.now();const [ar,br]=await Promise.all([first,b.call({op:'step',volts:{motor:-2}})]);
  expect(performance.now()-ready).toBeGreaterThanOrEqual(35);
  expect(ar.state.tick).toBe(1);expect(br.state.tick).toBe(1);expect(ar.state.motors).toEqual({motor:4});expect(br.state.motors).toEqual({motor:-2});expect(br.state.gameplay.captured).toBe(11);
  expect(ar.state.bodies.chassis).toBeDefined();expect(ar.state.bodies['r1/chassis']).toBeUndefined();expect(ar.state.bodies.ball).toBeDefined();
  const [ad,bd]=await Promise.all([a.call({op:'step',volts:{motor:0},state_delta:true}),b.call({op:'step',volts:{motor:0},state_delta:true})]);
  expect(ad.stateDelta.baseTick).toBe(1);expect(bd.stateDelta.state.tick).toBe(2);
  const waitingForBoundary=new Promise(resolve=>{stepped=resolve;});
  const pendingA=a.call({op:'step',volts:{motor:0}}).catch(error=>({error:String(error)}));
  const pendingB=b.call({op:'step',volts:{motor:0}});
  await waitingForBoundary;a.socket.destroy();
  const rejected=await pendingB;await pendingA;
  expect(rejected.ok).toBe(false);expect(match.failure).toContain('disconnected');
 }finally{await match?.close();for(const c of clients)c.socket.destroy();await rm(dir,{recursive:true,force:true});}
});

test('shared pacing corrects timer jitter and bounds catch-up after overload',()=>{
 const clock=new MatchPacing(20);
 expect(clock.afterStep(0,12)).toBe(8);
 expect(clock.afterStep(22,34)).toBe(6);
 expect(clock.afterStep(42,65)).toBe(0);
 expect(clock.afterStep(65,75)).toBe(5);
 expect(clock.afterStep(80,250)).toBe(0);
 expect(clock.afterStep(250,262)).toBe(8);
 expect(()=>new MatchPacing(NaN)).toThrow('period');
});

test('shared match rejects an unsupported solver schedule before native world loading',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cadcove-schedule-'));
 try{
  const marker=path.join(dir,'loaded'),binary=path.join(dir,'physics.mjs');
  await writeFile(binary,`#!${process.execPath}\nimport {createInterface} from 'node:readline';import {writeFileSync} from 'node:fs';for await(const line of createInterface({input:process.stdin})){const c=JSON.parse(line);if(c.op==='load')writeFileSync(${JSON.stringify(marker)},'loaded');console.log(JSON.stringify({ok:true,features:[]}));}`,{mode:0o700});
  const source=fixture();source.solver_schedule='per_tick';const config=compose(source);
  expect(config.robots.every(r=>r.world.solver_schedule==='per_tick')).toBe(true);
  await expect(startMatch({binary:process.execPath,binaryArgs:[binary],...config})).rejects.toThrow('solver-schedule-v1');
  await expect(access(marker)).rejects.toThrow();
  delete source.solver_schedule;source.max_contact_substeps=2;
  await expect(startMatch({binary:process.execPath,binaryArgs:[binary],...compose(source)})).rejects.toThrow('contact-refresh-budget-v1');
  await expect(access(marker)).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});

import {matchStation} from '../lib/match-session.js';
test('match stations are explicit, validated and preserve legacy Blue1 default',()=>{
 expect(matchStation({})).toBe('Blue1');
 for(const station of ['Blue1','Blue2','Blue3','Red1','Red2','Red3'])expect(matchStation({station})).toBe(station);
 for(const station of ['Red4','red','',0,false,null])expect(()=>matchStation({station})).toThrow('Invalid robot station');
});
