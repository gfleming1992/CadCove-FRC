import {test,expect} from 'bun:test';
import {simplifyVisual,prepareMatchVisuals} from '../lib/match-visuals.js';
import {frustumPlanes,visibleSphere,selectVisualLevel} from '../web/match-viewer.js';
import {matchFixture} from './match-fixture.js';
import {prepareMatchAssets} from '../lib/match-assets.js';
import {rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadAssembly} from '../web/simulation-scene.js';
test('visual simplification reduces a planar grid without moving vertices or mutating its source',async()=>{
 const positions=[],normals=[],indices=[],n=24;for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){positions.push(x,y,0);normals.push(0,0,1);}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;indices.push(a,b,d,a,d,c);}
 const part={id:'grid',name:'Grid',color:'#ffffff',positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices)},before=Array.from(part.indices),result=await simplifyVisual(part,.25);
 expect(result.part.indices.length).toBeLessThan(indices.length/4);expect(Array.from(part.indices)).toEqual(before);expect(result.errorMM).toBeLessThanOrEqual(.25);
 for(let i=2;i<result.part.positions.length;i+=3)expect(result.part.positions[i]).toBe(0);
 expect(Math.max(...result.part.indices)).toBeLessThan(result.part.positions.length/3);
});
test('frustum culling keeps intersecting bounds and LOD returns full detail when close',()=>{
 const planes=frustumPlanes([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 expect(visibleSphere(planes,[0,0,.5],.1)).toBe(true);expect(visibleSphere(planes,[2,0,.5],.1)).toBe(false);expect(visibleSphere(planes,[1.05,0,.5],.1)).toBe(true);expect(visibleSphere(planes,[0,0,-1],.1)).toBe(false);
 const levels=[{index:0,errorMetres:0,triangles:1000},{index:1,errorMetres:.001,triangles:200},{index:2,errorMetres:.004,triangles:30}];
 expect(selectVisualLevel(levels,100).index).toBe(2);expect(selectVisualLevel(levels,1000).index).toBe(1);expect(selectVisualLevel(levels,2000).index).toBe(0);
});
test('offline visual package preserves source bindings and validates every LOD hash',async()=>{
 const f=await matchFixture(),out=f.root+'/visuals',source=await readFile(f.root+'/robot/mesh.bin');
 try{
  const report=await prepareMatchVisuals({robot:f.root+'/robot',field:f.root+'/field',output:out});expect(report.physicsChanged).toBe(false);expect(await readFile(f.root+'/robot/mesh.bin')).toEqual(source);
  const assets=await prepareMatchAssets({robot:out+'/robot',field:out+'/field',bindings:f.root+'/bindings.json'},f.robots,f.assets.manifest.bodyIds);
  const a=await loadAssembly('robot','/robot',{includeLods:true,fetcher:async url=>{const bytes=await assets.read(url.slice(1));return bytes?new Response(bytes):new Response('',{status:404});}});
  expect(a.instances[0].sourceId).toBe('part');expect(a.instances[0].lods.length).toBe(3);expect(a.prototypes.length).toBe(4);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('headless benchmark validates controller timelines and reports the physics deadline',async()=>{
 const {validateScenario,summarizeTiming}=await import('../lib/match-benchmark.js');
 const scenario={schema:1,duration:10,phases:[{at:0,robots:{r0:{enabled:true,controllers:[]}}}]};expect(validateScenario(scenario,['r0'])).toBe(scenario);
 expect(()=>validateScenario({...scenario,phases:[{at:0,robots:{r9:{enabled:true,controllers:[]}}}]},['r0'])).toThrow('Unknown');
 expect(()=>validateScenario({...scenario,phases:[{at:1,robots:{}}]},['r0'])).toThrow('zero');
 expect(()=>validateScenario({...scenario,phases:[{at:0,robots:{r0:{enabled:true,controllers:[],sequence:99}}}]},['r0'])).toThrow('controller input');
 const summary=summarizeTiming([{physicsMs:2,exchangeMs:3},{physicsMs:8,exchangeMs:10}],5);expect(summary.physics.meanMs).toBe(5);expect(summary.physics.overBudget).toBe(1);expect(summary.exchange.p95Ms).toBe(10);
});

test('interrupted headless benchmark closes its session and retains partial timing and inputs',async()=>{
 const {benchmarkMatch}=await import('../lib/match-benchmark.js'),f=await matchFixture();let closed=false;
 try{
  await writeFile(f.root+'/native','test-only executable identity');
  await writeFile(f.root+'/match.json',JSON.stringify({world:{dt:.005},robots:f.robots}));
  await writeFile(f.root+'/config.json',JSON.stringify({schema:1,match:'match.json',nativeBinary:'native'}));
  await writeFile(f.root+'/scenario.json',JSON.stringify({schema:1,duration:1,phases:[{at:0,robots:{}}]}));
  const output=f.root+'/failed-run';
  const report=await benchmarkMatch({config:f.root+'/config.json',scenario:f.root+'/scenario.json',output,launchSession:async(_,{onStep})=>{
   await mkdir(output);const coordinator={snapshot:{tick:0,time:0,bodies:{}}};
   return {coordinator,pids:[process.pid],close:async()=>{closed=true;},sendControls:async()=>{
    coordinator.snapshot={tick:coordinator.snapshot.tick+1,time:coordinator.snapshot.time+.005,bodies:{}};onStep({snapshot:coordinator.snapshot,input:{volts:{},coast:[]},physicsMs:8,exchangeMs:10});throw Error('Controller connection lost');
   }};
  }});
  expect(closed).toBe(true);expect(report.ok).toBe(false);expect(report.completedScenario).toBe(false);expect(report.final.tick).toBe(2);expect(report.simSeconds).toBe(.01);expect(report.timing.physics.meanMs).toBe(8);
  expect(JSON.parse(await readFile(output+'/benchmark.json','utf8')).error).toContain('Controller connection lost');expect(JSON.parse(await readFile(output+'/measured-inputs.json','utf8')).length).toBe(2);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('headless behavior records cross-robot contact ticks and actual chassis travel',async()=>{
 const {matchBehavior}=await import('../lib/match-benchmark.js'),robots=[{id:'r0',prefix:'r0/'},{id:'r1',prefix:'r1/'}],b=matchBehavior(robots);
 const state=(time,x,contacts)=>({time,contacts,bodies:{'r0/chassis':{position:[x,0,.1],velocity:[1,0,0],quaternion:[0,0,0,1]},'r1/chassis':{position:[2,0,.1],velocity:[0,0,0],quaternion:[0,0,0,1]}}});
 b.observe(state(0,0,[['r0/arm','r0/chassis'],['r0/wheel','field']]));
 b.observe(state(.02,.1,[['r0/arm','r1/chassis'],['r1/wheel','r0/chassis']]));
 expect(b.result.minChassisSeparation.distance).toBeCloseTo(1.9);
 const third=state(.04,.1,[]);third.gameplay={carried:['ball1','ball1','ball2']};b.observe(third);b.observe(third);expect(b.result.inventorySeen.r0).toEqual(['ball1','ball2']);
 expect(b.result.robotContactTicks).toBe(1);expect(b.result.robotPairs['r0:r1'].ticks).toBe(1);expect(b.result.chassis.r0.pathMetres).toBeCloseTo(.1);expect(b.result.chassis.r0.maxSpeed).toBe(1);expect(b.result.chassis.r1.minUpZ).toBe(1);expect(b.result.finite).toBe(true);
});
