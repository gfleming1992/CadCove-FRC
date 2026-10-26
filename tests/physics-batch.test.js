import {test,expect} from 'bun:test';
import {existsSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {numericalWorld,validatePhysicsBatch,runPhysicsBatch,PhysicsBatchJobs} from '../lib/physics-batch.js';
const binary=path.resolve('target/distribution/release/instantcad-sim'+(process.platform==='win32'?'.exe':''));
const world=()=>({dt:.02,max_contact_substeps:2,gravity:[0,0,0],bodies:[{id:'ball',position:[0,0,0],velocity:[1,0,0],colliders:[{kind:'ball',radius:.1}]}],joints:[],motors:[]});
const plan=()=>({profiles:[{id:'play',settings:{dt:.02}},{id:'offline',settings:{dt:.005,max_contact_substeps:null}}],segments:[{seconds:1,volts:{}}],checks:{maxLinearSpeed:2,positions:[{id:'ball',axis:0,min:.99,max:1.01}]}});
test('numerical profiles preserve physical model and explicitly remove a gameplay cap',()=>{
 const w=world(),before=structuredClone(w),out=numericalWorld(w,{dt:.001,max_contact_substeps:null});
 expect(out.dt).toBe(.001);expect(out).not.toHaveProperty('max_contact_substeps');expect(w).toEqual(before);
 expect(numericalWorld(w,{local_cylinder_contacts:true}).local_cylinder_contacts).toBe(true);
 for(const value of [null,1,'true'])expect(()=>numericalWorld(w,{local_cylinder_contacts:value})).toThrow('Invalid numerical setting');
 out.bodies[0].mass=100;expect(w.bodies[0].mass).toBeUndefined();
 for(const setting of [{dt:0},{dt:.03},{solver_iterations:0},{solver_schedule:'fast'},{max_contact_substeps:65},{bodies:[]},{gravity:[0,0,0]}])expect(()=>numericalWorld(w,setting)).toThrow();
});
test('batch inputs and practical acceptance ranges are validated before spawning',()=>{
 expect(validatePhysicsBatch(world(),plan())).toEqual(plan());
 for(const change of [p=>p.profiles.push(p.profiles[0]),p=>p.segments[0].volts={unknown:2},p=>p.segments[0].seconds=Infinity,p=>p.profiles[0].settings.dt=1e-9,p=>p.checks.positions[0].id='missing',p=>p.checks.positions[0].axis=3,p=>p.checks.positions[0].min=4]){const p=plan();change(p);expect(()=>validatePhysicsBatch(world(),p)).toThrow();}
});
test.skipIf(!existsSync(binary))('isolated native batch resets every profile, honors dt, preserves source and reports acceptance failures',async()=>{
 const w=world(),before=structuredClone(w),p=plan();let pulses=0;const timer=setInterval(()=>pulses++,1);
 let result;try{result=await runPhysicsBatch({binary,world:w,plan:p});}finally{clearInterval(timer);}
 expect(result.ok).toBe(true);expect(result.rendering).toBe(false);expect(result.robotCode).toBe(false);expect(pulses).toBeGreaterThan(0);expect(w).toEqual(before);
 expect(result.trials.map(t=>t.ticks)).toEqual([50,200]);expect(result.trials.every(t=>t.accepted)).toBe(true);
 expect(result.trials[1].final.bodies.ball.position[0]).toBeCloseTo(1,3);
 expect(result.trials[0].worldHash).not.toBe(result.trials[1].worldHash);
 p.profiles=p.profiles.slice(0,1);p.checks.maxLinearSpeed=.5;
 const failed=await runPhysicsBatch({binary,world:w,plan:p});expect(failed.ok).toBe(false);expect(failed.trials[0].failures).toContain('maxLinearSpeed');
 delete p.checks;const structural=await runPhysicsBatch({binary,world:w,plan:p});expect(structural.ok).toBe(true);expect(structural.trials[0].accepted).toBeNull();
});
test.skipIf(!existsSync(binary))('background jobs return pending, serialize work, cancel owned processes and retain results',async()=>{
 const jobs=new PhysicsBatchJobs(),p=plan();p.segments[0].seconds=30;
 try{
  const first=jobs.start({binary,world:world(),plan:p});expect(first.pending).toBe(true);
  expect(()=>jobs.start({binary,world:world(),plan:p})).toThrow('already running');
  const deadline=Date.now()+5000;while(!jobs.status(first.id).progress&&Date.now()<deadline)await Bun.sleep(1);
  expect(jobs.status(first.id).progress.tick).toBeGreaterThanOrEqual(20);expect(jobs.status(first.id).pending).toBe(true);
  jobs.cancel(first.id);await jobs.jobs.get(first.id).done;expect(jobs.status(first.id).phase).toBe('cancelled');
  const next=jobs.start({binary,world:world(),plan:plan()},{save:async()=>'/test/report.json'});
  await jobs.jobs.get(next.id).done;const done=jobs.status(next.id);expect(done.phase).toBe('complete');expect(done.result.ok).toBe(true);expect(done.reportFile).toBe('/test/report.json');expect(done.result.trials[0]).not.toHaveProperty('final');
 }finally{jobs.close();}
 expect(()=>jobs.start({binary,world:world(),plan:p})).toThrow('closed');
});
test.skipIf(!existsSync(binary))('CLI writes exclusive hashed evidence without changing source or starting a viewer',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cadcove-batch-'));
 try{
  await writeFile(path.join(dir,'world.json'),JSON.stringify(world()));await writeFile(path.join(dir,'plan.json'),JSON.stringify(plan()));
  const command=()=>Bun.spawn([process.execPath,path.resolve('bin/cadcove.js'),'physics-batch','--world',path.join(dir,'world.json'),'--input',path.join(dir,'plan.json'),'--output',path.join(dir,'report.json')],{env:{...process.env,INSTANTCAD_SIM_BINARY:binary},stdout:'pipe',stderr:'pipe'});
  const child=command(),out=JSON.parse(await new Response(child.stdout).text());expect(await child.exited).toBe(0);expect(out.ok).toBe(true);expect(out.provenance.nativeHash).toHaveLength(64);
  const saved=await readFile(path.join(dir,'report.json'),'utf8');expect(JSON.parse(saved).trials[0].final.tick).toBe(50);
  const second=command();await new Response(second.stdout).text();expect(await second.exited).toBe(2);expect(await readFile(path.join(dir,'report.json'),'utf8')).toBe(saved);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('editor batch backend loads as CommonJS without evaluating CLI module paths',async()=>{
 const {build}=await import('esbuild'),dir=await mkdtemp(path.join(os.tmpdir(),'cadcove-batch-cjs-'));
 try{
  const file=path.join(dir,'batch.cjs');
  const result=await build({entryPoints:[path.resolve('lib/physics-batch.js')],outfile:file,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  expect(result.warnings).toEqual([]);
  const {createRequire}=await import('node:module'),api=createRequire(import.meta.url)(file);
  const jobs=new api.PhysicsBatchJobs();jobs.close();expect(api.numericalWorld(world(),{dt:.005}).dt).toBe(.005);
 }finally{await rm(dir,{recursive:true,force:true});}
});
