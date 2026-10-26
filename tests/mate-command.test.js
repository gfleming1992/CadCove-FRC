import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mateCommand,motionFromPose} from '../lib/mate-command.js';
test('live solve preserves posed independent joints without driving coupled followers twice',()=>{
 const definition={schema:1,units:'mm-deg',bodies:[{id:'base',fixed:true,origin:[0,0,0],parts:['base']},...['steer','input','output'].map(id=>({id,fixed:false,origin:[0,0,0],parts:[id]}))],joints:['steer','input','output'].map(id=>({id,type:'revolute',parent:id==='steer'?'base':'steer',child:id,origin:[0,0,0],axis:[0,0,1]})),relations:[{id:'gears',type:'gear',driver:'input',follower:'output',driverTeeth:20,followerTeeth:40,direction:-1}]};
 const state={running:false,angles:{steer:37,input:1000,output:-500}},motion={duration:1,samplePeriod:.05,drives:[{joint:'output',velocity:30}]};
 expect(motionFromPose(definition,motion,state).drives).toEqual([{joint:'output',velocity:30,position:-500},{joint:'steer',position:37}]);
 expect(motion.drives[0].position).toBeUndefined();
 expect(()=>motionFromPose(definition,motion,{...state,running:true})).toThrow('Pause');
 expect(()=>motionFromPose(definition,motion,{angles:{output:-500}})).toThrow('missing');
 expect(()=>motionFromPose(definition,null,state)).toThrow('drive');
});
test('mate CLI advertises limited capabilities without loading CAD',async()=>{
 const c=await mateCommand({action:'capabilities'});expect(c.mates).toEqual(['fixed','revolute','slider']);expect(c.couplings).toEqual(['gear','belt','chain']);expect(c.continuousPulleyBindings).toBe(true);expect(c.physics).toBe(false);expect(c.closedLoops).toBe(true);
 await expect(mateCommand({action:'solve'})).rejects.toThrow('input');
 expect(c.commands).toContain('inspect-step');expect(c.stepInspection.automaticSolverMapping).toBe(false);
 expect(c.defaultBackend).toBe('rapier');expect(c.solver).toBe('Rapier');expect((await mateCommand({action:'capabilities',solver:'/explicit/legacy/solver'})).solver).toBe('Rapier');expect(c.backends).toEqual(['rapier']);
 expect((await mateCommand({action:'capabilities',backend:'rapier'})).solver).toBe('Rapier');
 await expect(mateCommand({backend:'unknown'})).rejects.toThrow('backend');
 await expect(mateCommand({action:'inspect-step'})).rejects.toThrow('STEP_FILE');
});
test.skipIf(!process.env.CADCOVE_STEP_FIXTURE)('agent STEP inspection preserves metadata without claiming solver readiness',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cadcove-step-'));
 try{
  const output=path.join(dir,'report.json'),options={action:'inspect-step',input:process.env.CADCOVE_STEP_FIXTURE,output};
  const result=await mateCommand(options);expect(result.ok).toBe(true);expect(result.hasKinematics).toBe(true);expect(result.solverReady).toBe(false);
  const report=JSON.parse(await readFile(output,'utf8'));expect(report.pairs.length).toBeGreaterThan(0);expect(report.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(mateCommand(options)).rejects.toThrow('File exists');
 }finally{await rm(dir,{recursive:true,force:true});}
},65000);
test.skipIf(!process.env.CADCOVE_RAPIER_MATE_SOLVER)('Rapier CLI solves the same request and never overwrites evidence',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cadcove-rapier-'));
 try{
  const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],input=path.join(dir,'input.json'),output=path.join(dir,'output.json');
  await writeFile(input,JSON.stringify({schema:1,units:'mm-deg-s',bodies:[{id:'base',pose:I,fixed:true},{id:'slide',pose:I}],mates:[{id:'s',type:'slider',a:{body:'base',frame:I},b:{body:'slide',frame:I}}],drives:[{joint:'s',velocity:10}],duration:.1,samplePeriod:.05}));
  const options={backend:'rapier',action:'solve',input,output,solver:process.env.CADCOVE_RAPIER_MATE_SOLVER};
  expect((await mateCommand(options)).solver).toBe('Rapier');
  expect(JSON.parse(await readFile(output,'utf8')).frames.at(-1).poses[1][14]).toBeCloseTo(1,4);
  await expect(mateCommand(options)).rejects.toThrow('File exists');
 }finally{await rm(dir,{recursive:true,force:true});}
},70000);
