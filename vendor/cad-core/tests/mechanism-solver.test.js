import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {mechanismSolverRequest} from '../src/core/mechanism-solver.js';
import {validateMechanism,mechanismPose} from '../src/core/mechanism.js';
import {compileSolvedMotion,evaluateSolvedMotion} from '../src/core/solved-motion.js';
const mechanism=()=>({schema:1,units:'mm-deg',bodies:[{id:'base',fixed:true,origin:[10,20,30],parts:['base']},{id:'carrier',fixed:false,origin:[20,30,40],parts:['carrier']},{id:'pinion',fixed:false,origin:[30,40,50],parts:['pinion']},{id:'gear',fixed:false,origin:[50,60,70],parts:['gear']}],joints:[{id:'steer',parent:'base',child:'carrier',type:'revolute',origin:[12,20,30],axis:[0,0,1],bindAngleDeg:20,limitsDeg:[-90,90]},{id:'input',parent:'carrier',child:'pinion',type:'revolute',origin:[30,40,50],axis:[0,.6,.8],bindAngleDeg:10},{id:'output',parent:'carrier',child:'gear',type:'revolute',origin:[50,60,70],axis:[0,.6,.8],bindAngleDeg:25}],relations:[{id:'gear',type:'gear',driver:'input',follower:'output',driverTeeth:20,followerTeeth:40,direction:-1,phaseDeg:30}]});
test('mechanism adapter resolves follower targets, bind offsets and polynomial extrema',()=>{
 const r=mechanismSolverRequest(mechanism(),{duration:1,samplePeriod:.02,drives:[{joint:'output',position:25,velocity:60}]},'revision');
 expect(r.drives.find(d=>d.joint==='input').velocity).toBe(-120);
 expect(r.drives.find(d=>d.joint==='input').position).toBe(0);
 expect(r.jointBindings.find(d=>d.joint==='output').offsetDeg).toBe(25);
 expect(()=>mechanismSolverRequest(mechanism(),{duration:2,samplePeriod:.02,drives:[{joint:'steer',position:0,velocity:200,acceleration:-200}]},'r')).toThrow('limit');
 expect(()=>mechanismSolverRequest(mechanism(),{duration:1,samplePeriod:.02,drives:[{joint:'input'},{joint:'output'}]},'r')).toThrow('Conflicting');
 const m=mechanism();m.joints[2].axis=[1,0,0];
 expect(()=>mechanismSolverRequest(m,{duration:1,samplePeriod:.02,drives:[]},'r')).toThrow('parallel');
});
test.skipIf(!process.env.CADCOVE_MATE_SOLVER)('native solved nested tilted shafts match independent tree transforms',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-solve-tree-'));
 try{
  const m=validateMechanism(mechanism()),r=mechanismSolverRequest(m,{duration:1,samplePeriod:.02,drives:[{joint:'steer',position:45,velocity:30},{joint:'output',position:1000,velocity:720,acceleration:-1440}]},'revision');
  await fs.writeFile(path.join(root,'request.json'),JSON.stringify(r));
  const p=Bun.spawn([process.env.CADCOVE_PYTHON??'python3',path.resolve(import.meta.dir,'../src/native/ondsel/solver.py'),'--input',path.join(root,'request.json'),'--output',path.join(root,'result.json')],{stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw Error(out+err);
  const solution=JSON.parse(await fs.readFile(path.join(root,'result.json'),'utf8')),plan=compileSolvedMotion(solution,m.bodies.flatMap(b=>b.parts),'revision',m);
  let maxError=0;
  for(const f of solution.frames){const actual=evaluateSolvedMotion(plan,f.time),expected=mechanismPose(m,'steer',f.angles.steer,f.angles);for(const b of m.bodies)for(let k=0;k<12;k++)maxError=Math.max(maxError,Math.abs(actual.transforms[b.parts[0]][k]-expected.transforms[b.parts[0]][k]));}
  expect(maxError).toBeLessThan(1e-7);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},65000);
