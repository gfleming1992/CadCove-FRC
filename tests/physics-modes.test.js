import {test,expect} from 'bun:test';
import {physicsModeWorld} from '../lib/physics-modes.js';
const source={dt:.005,bodies:[{id:'ball',compliance:{subdivisions:1}}],joints:[],motors:[]};
test('accurate mode retains all source settings and cannot share mutable structures with gameplay',()=>{
 const accurate=physicsModeWorld(source,'accurate');
 const gameplay=physicsModeWorld(source,'gameplay',{soft_contact_max_angle_rad:.3});
 gameplay.bodies[0].compliance.subdivisions=0;
 expect(accurate).toEqual(source);expect(source.bodies[0].compliance.subdivisions).toBe(1);
 expect(accurate).not.toHaveProperty('soft_contact_max_angle_rad');
});
test('mode recipes cannot quietly replace CAD, motors or use an unknown mode',()=>{
 expect(()=>physicsModeWorld(source,'fast')).toThrow('Unknown physics mode');
 expect(()=>physicsModeWorld(source,'gameplay')).toThrow('recipe');
 for(const field of ['bodies','motors','joints','gravity','unknown'])
  expect(()=>physicsModeWorld(source,'gameplay',{[field]:[]})).toThrow('Unsupported gameplay setting');
});
test('explicit mechanism profile removes only selected ball compliance and preserves original detailed source',()=>{
 const detailed={...source,bodies:[{id:'ball',compliance:{subdivisions:1}},{id:'other',compliance:{subdivisions:1}}],compliance_zones:[{id:'intake'}]};
 const settings={gameplay:{balls:['ball']}};
 const practice=physicsModeWorld(detailed,'gameplay',settings);
 expect(practice.bodies[0]).not.toHaveProperty('compliance');
 expect(practice.bodies[1].compliance).toEqual({subdivisions:1});
 expect(detailed.bodies[0].compliance).toEqual({subdivisions:1});
 practice.gameplay.balls.push('other');expect(settings.gameplay.balls).toEqual(['ball']);
 expect(physicsModeWorld(detailed,'accurate')).toEqual(detailed);
});

test('approximate source cannot be relabeled as accurate',()=>{
 expect(()=>physicsModeWorld({...source,gameplay:{balls:['ball']}},'accurate')).toThrow('detailed source');
});

test('field foam preserves authored material only in fixed-field activation zones',()=>{
 const detailed={...source,bodies:[...source.bodies,{id:'field',fixed:true},{id:'intake'}],compliance_zones:[{body:'field',half:[1,1,1]},{body:'intake',half:[.1,.1,.1]}]};
 const practice=physicsModeWorld(detailed,'gameplay',{gameplay:{balls:['ball'],field_compliance:true}});
 expect(practice.bodies[0].compliance).toEqual(source.bodies[0].compliance);
 expect(practice.compliance_zones).toEqual([detailed.compliance_zones[0]]);
 expect(detailed.compliance_zones.length).toBe(2);
 const coarse=physicsModeWorld(detailed,'gameplay',{gameplay:{balls:['ball'],field_compliance:true},fieldFoamSubdivisions:0});
 expect(coarse.bodies[0].compliance.subdivisions).toBe(0);
 expect(detailed.bodies[0].compliance.subdivisions).toBe(1);
 expect(coarse).not.toHaveProperty('fieldFoamSubdivisions');
 for(const value of [-1,3,NaN])expect(()=>physicsModeWorld(detailed,'gameplay',{gameplay:{balls:['ball'],field_compliance:true},fieldFoamSubdivisions:value})).toThrow('resolution');
 expect(()=>physicsModeWorld(source,'gameplay',{gameplay:{balls:['ball'],field_compliance:true}})).toThrow('authored fixed-field zones');
});

import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPhysicsMode} from '../lib/physics-modes.js';
import {readRobotProject,auditRobotProject,hash} from '../lib/robot-project.js';
test('installed mode builder relocates references, pins recipes and keeps detailed bytes and prior builds',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cadcove-modes-'));
 try{
  for(const dir of ['cad','field','compiled','code','inputs','modes'])await mkdir(path.join(root,dir));
  const put=(file,value)=>writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));
  const world={dt:.005,bodies:[{id:'chassis'}],joints:[],motors:[]};
  const original=JSON.stringify(world,null,2)+'\n',digest=hash(original);
  await put('inputs/model.js','original');await put('compiled/world.json',original);
  await put('compiled/scene-bindings.json',{schema:1,start:[0,0,0],fieldOrigin:[0,0,0],worldHash:digest,sourceHash:'robot',fieldSourceHash:'field',robot:{},field:{},sourceInputs:{schema:1,files:[{file:'inputs/model.js',sha256:hash('original')}]}});
  for(const dir of ['cad','field']){await put(dir+'/assembly.json',{sourceHash:dir==='cad'?'robot':'field'});await put(dir+'/instances.json',[]);}
  const profile={schema:1,id:'example',name:'Example',cad:{robot:'cad',field:'field'},build:'compiled',runtime:{adapter:'wpilib-java-phoenix6',project:'code',jar:'code/robot.jar',nativeLibraries:'code/jni',customSimulator:{sourceDirectory:'rust-source',package:'team-sim',binary:'team-sim'}},calibration:[]};
  await put('robot.sim.json',profile);
  const project=path.join(root,'robot.sim.json'),detailed=path.join(root,'modes/detailed'),practice=path.join(root,'modes/practice');
  const accurate=await createPhysicsMode({project,mode:'accurate',output:detailed});
  expect(await readFile(path.join(detailed,'world.json'),'utf8')).toBe(original);
  expect((await auditRobotProject(await readRobotProject(accurate.project))).canLoad).toBe(true);
  const moved=JSON.parse(await readFile(accurate.project));expect(moved.runtime.assetRoot).toBe('../..');expect(moved.runtime.jar).toBe('../../code/robot.jar');expect(moved.runtime.customSimulator.sourceDirectory).toBe('../../rust-source');
  const recipeFile=path.join(root,'practice.json');
  const recipe={sourceWorldHash:digest,description:'Solver trial',evidence:'Uncalibrated',settings:{solver_iterations:4}};
  await put('practice.json',recipe);
  const result=await createPhysicsMode({project,mode:'gameplay',output:practice,recipeFile});
  expect((await auditRobotProject(await readRobotProject(result.project))).canLoad).toBe(true);
  expect(JSON.parse(await readFile(path.join(practice,'world.json'))).solver_iterations).toBe(4);
  await expect(createPhysicsMode({project,mode:'accurate',output:practice})).rejects.toThrow();
  await expect(createPhysicsMode({project:result.project,mode:'accurate',output:path.join(root,'bad')})).rejects.toThrow('original detailed');
  await put('practice.json',{...recipe,sourceWorldHash:'0'.repeat(64)});
  await expect(createPhysicsMode({project,mode:'gameplay',output:path.join(root,'bad'),recipeFile})).rejects.toThrow('sourceWorldHash');
  await put('inputs/model.js','changed');
  await expect(createPhysicsMode({project,mode:'accurate',output:path.join(root,'bad')})).rejects.toThrow('audit failed');
  expect(await readFile(path.join(root,'compiled/world.json'),'utf8')).toBe(original);
 }finally{await rm(root,{recursive:true,force:true});}
});
