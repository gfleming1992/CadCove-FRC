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
test.skipIf(!process.env.CADCOVE_MATE_SOLVER)('agent command solves driven slider and refuses overwriting prior evidence',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cadcove-mates-'));
 try{
  const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],input=path.join(dir,'request.json'),output=path.join(dir,'result.json');
  const request={schema:1,units:'mm-deg-s',sourceRevision:'fixture',bodies:[{id:'base',pose:I,fixed:true},{id:'slide',pose:I}],mates:[{id:'slider',type:'slider',a:{body:'base',frame:I},b:{body:'slide',frame:I}}],drives:[{joint:'slider',velocity:10}],duration:.1,samplePeriod:.05};
  await writeFile(input,JSON.stringify(request));const r=await mateCommand({action:'solve',input,output});expect(r.ok).toBe(true);expect(r.frames).toBe(3);
  const result=JSON.parse(await readFile(output,'utf8'));expect(result.frames.at(-1).poses[1][14]).toBeCloseTo(1,8);expect(result.sourceRevision).toBe('fixture');
  await expect(mateCommand({action:'solve',input,output})).rejects.toThrow('File exists');
 }finally{await rm(dir,{recursive:true,force:true});}
},70000);
