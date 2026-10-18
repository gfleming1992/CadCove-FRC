import {test,expect} from 'bun:test';
import {mkdtemp,rm,mkdir,writeFile,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readRobotProject,auditRobotProject,hash} from '../lib/robot-project.js';

async function fixture(run){
 const root=await mkdtemp(path.join(os.tmpdir(),'robot-project-'));
 try{
  for(const folder of ['cad','season','out'])await mkdir(path.join(root,folder));
  const world={dt:.005,bodies:[{id:'chassis'},{id:'lift'}],joints:[{id:'slide',parent:'chassis',child:'lift'}],motors:[{id:'elevator-left',joint:'slide',rotor_per_unit:20}]};
  const bytes=JSON.stringify(world),scene={schema:1,start:[0,0,0],fieldOrigin:[0,0,0],worldHash:hash(bytes),sourceHash:'robot-revision',fieldSourceHash:'field-revision',robot:{part:{body:'lift',local:[1,0,0,0,0,1,0,0,0,0,1,0]}},field:{}};
  const profile={schema:1,id:'other-team',name:'Another robot',cad:{robot:'cad',field:'season'},build:'out',runtime:{adapter:'wpilib-java-phoenix6',project:'code',jar:'code/out/robot.jar',nativeLibraries:'code/jni'},calibration:[]};
  const write=(file,value)=>Bun.write(path.join(root,file),JSON.stringify(value));
  await write('robot.sim.json',profile);await write('out/world.json',world);await write('out/scene-bindings.json',scene);
  await write('cad/assembly.json',{sourceHash:'robot-revision'});await write('cad/instances.json',[{id:'part'}]);
  await write('season/assembly.json',{sourceHash:'field-revision'});await write('season/instances.json',[]);
  await run({root,profile,world,scene,write,load:()=>readRobotProject(path.join(root,'robot.sim.json'))});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('robot project paths are relative to its file, independent of team and cwd',async()=>fixture(async f=>{
 const project=await f.load(),report=await auditRobotProject(project);
 expect(project.runtime.jar).toBe(path.join(f.root,'code/out/robot.jar'));expect(project.build).toBe(path.join(f.root,'out'));
 expect(report.canLoad).toBe(true);expect(report.robotMotors).toBe(1);expect(report.reviewRequired.length).toBe(6);expect(report.qualification).toBe('not-certified');
 expect(report.sourceFreshness.status).toBe('untracked');
}));
test('artifact audit rejects malformed bind transforms before native or viewer startup',()=>fixture(async f=>{
 const original=structuredClone(f.scene);
 for(const change of [s=>delete s.robot.part.local,s=>s.robot.part.local[0]=1000,s=>s.start=[0,0],s=>s.fieldOrigin=null,s=>s.robot=null,s=>s.schema=2]){
  const scene=structuredClone(original);change(scene);await f.write('out/scene-bindings.json',scene);
  expect((await auditRobotProject(await f.load())).canLoad).toBe(false);
 }
 original.field.gate={body:'lift',local:[0,-1,0,.5,1,0,0,0,0,0,1,.2]};
 await f.write('season/instances.json',[{id:'gate'}]);await f.write('out/scene-bindings.json',original);
 expect((await auditRobotProject(await f.load())).canLoad).toBe(true);
 original.field.gate.bindPosition=[0,0,0];await f.write('out/scene-bindings.json',original);
 const report=await auditRobotProject(await f.load());expect(report.canLoad).toBe(false);expect(report.errors.join(' ')).toContain('not both');
}));
test('source fingerprints reject stale and missing CAD while leaving unchanged builds usable',()=>fixture(async f=>{
 await mkdir(path.join(f.root,'design'));
 const source='export default () => buildRobot();';await writeFile(path.join(f.root,'design/model.js'),source);
 f.scene.sourceInputs={schema:1,files:[{file:'design/model.js',sha256:hash(source)}]};await f.write('out/scene-bindings.json',f.scene);
 const verified=await auditRobotProject(await f.load());expect(verified.canLoad).toBe(true);expect(verified.sourceFreshness.status).toBe('verified');
 await writeFile(path.join(f.root,'design/model.js'),source+' // source edit');
 const stale=await auditRobotProject(await f.load());expect(stale.canLoad).toBe(false);expect(stale.sourceFreshness.status).toBe('stale');expect(stale.errors.some(e=>e.includes('Source input changed: design/model.js'))).toBe(true);
 await rm(path.join(f.root,'design/model.js'));
 const missing=await auditRobotProject(await f.load());expect(missing.canLoad).toBe(false);expect(missing.errors.some(e=>e.includes('Source input unavailable'))).toBe(true);
}));
test('source inputs resolve against explicit asset root and reject escaping or malformed declarations',()=>fixture(async f=>{
 await mkdir(path.join(f.root,'inputs'));await writeFile(path.join(f.root,'inputs/model.js'),'original');
 f.profile.runtime.assetRoot='inputs';await f.write('robot.sim.json',f.profile);
 f.scene.sourceInputs={schema:1,files:[{file:'model.js',sha256:hash('original')}]};await f.write('out/scene-bindings.json',f.scene);
 expect((await auditRobotProject(await f.load())).sourceFreshness.status).toBe('verified');
 for(const record of [{schema:1,files:[]},{schema:1,files:[{file:'../profile.json',sha256:'a'.repeat(64)}]},{schema:1,files:[{file:'model.js',sha256:'bad'}]},{schema:1,files:[{file:'model.js',sha256:hash('original')},{file:'MODEL.js',sha256:hash('original')}]}]){
  f.scene.sourceInputs=record;await f.write('out/scene-bindings.json',f.scene);expect((await auditRobotProject(await f.load())).canLoad).toBe(false);
 }
 await writeFile(path.join(f.root,'outside.js'),'outside');
 const linked=process.platform==='win32'?'linked/outside.js':'link.js';
 if(process.platform==='win32')await symlink(f.root,path.join(f.root,'inputs/linked'),'junction');
 else await symlink(path.join(f.root,'outside.js'),path.join(f.root,'inputs/link.js'),'file');
 f.scene.sourceInputs={schema:1,files:[{file:linked,sha256:hash('outside')}]};await f.write('out/scene-bindings.json',f.scene);
 expect((await auditRobotProject(await f.load())).canLoad).toBe(false);
}));
test('stale compiled world, changed CAD and unbound motors/parts are load errors',async()=>fixture(async f=>{
 f.world.motors[0].joint='missing';await f.write('out/world.json',f.world);
 f.scene.robot.part.body='missing-body';await f.write('out/scene-bindings.json',f.scene);
 await f.write('cad/assembly.json',{sourceHash:'new-CAD'});
 const result=await auditRobotProject(await f.load());expect(result.canLoad).toBe(false);
 for(const fragment of ['different builds','CAD revision','Unbound motor','Invalid robot occurrence'])expect(result.errors.some(e=>e.includes(fragment))).toBe(true);
}));
test('explicitly unsupported runtime and malformed calibration never silently fall back',async()=>fixture(async f=>{
 f.profile.runtime.adapter='unknown';await f.write('robot.sim.json',f.profile);await expect(f.load()).rejects.toThrow('Unsupported');
 f.profile.runtime.adapter='wpilib-java-phoenix6';f.profile.calibration=[{subject:'mass',status:'probably',evidence:'guess'}];await f.write('robot.sim.json',f.profile);await expect(f.load()).rejects.toThrow('calibration');
}));
test('unknown clock cannot silently advance robot timers independently of physics',async()=>fixture(async f=>{
 f.profile.runtime.clock='physcis';await f.write('robot.sim.json',f.profile);await expect(f.load()).rejects.toThrow('Unsupported robot clock');
 f.profile.runtime.clock='physics';await f.write('robot.sim.json',f.profile);expect((await f.load()).profile.runtime.clock).toBe('physics');
}));
test('physics mode provenance distinguishes approximate builds from unchanged accurate worlds',async()=>fixture(async f=>{
 const digest=hash(JSON.stringify(f.world));
 f.profile.physicsMode={name:'accurate',worldHash:digest,sourceWorldHash:digest,settings:{}};
 await f.write('robot.sim.json',f.profile);expect((await auditRobotProject(await f.load())).canLoad).toBe(true);
 f.profile.physicsMode.sourceWorldHash='a'.repeat(64);await f.write('robot.sim.json',f.profile);
 expect((await auditRobotProject(await f.load())).errors).toContain('Accurate mode must preserve source world bytes');
 f.profile.physicsMode.name='gameplay';f.profile.physicsMode.settings={soft_contact_max_angle_rad:.3};
 await f.write('robot.sim.json',f.profile);
 expect((await auditRobotProject(await f.load())).errors).toContain('Physics mode setting mismatch: soft_contact_max_angle_rad');
}));

test('project source root tracks CAD siblings without relocating native collision assets',()=>fixture(async f=>{
 await mkdir(path.join(f.root,'collision-assets'));
 f.profile.runtime.assetRoot='collision-assets';await f.write('robot.sim.json',f.profile);
 await writeFile(path.join(f.root,'cad/model.js'),'original');
 f.scene.sourceInputs={schema:1,root:'project',files:[{file:'cad/model.js',sha256:hash('original')}]};
 await f.write('out/scene-bindings.json',f.scene);
 expect((await auditRobotProject(await f.load())).sourceFreshness.status).toBe('verified');
 await writeFile(path.join(f.root,'cad/model.js'),'changed');
 expect((await auditRobotProject(await f.load())).canLoad).toBe(false);
 f.scene.sourceInputs.root='../';await f.write('out/scene-bindings.json',f.scene);
 expect((await auditRobotProject(await f.load())).errors.join(' ')).toContain('Invalid source input root');
}));

test('declared shaft points reject orbiting meshes, permit axial offsets and arbitrary CAD origins',()=>fixture(async f=>{
 const j=f.world.joints[0];Object.assign(j,{kind:'revolute',axis:[0,2,0],anchor_child:[0,0,0]});
 const s=f.scene;s.axisChecks=[{instance:'part',joint:j.id,point:[0,0,0],toleranceM:.001}];s.robot.part.local[7]=.00635;
 await f.write('out/world.json',f.world);s.worldHash=hash(JSON.stringify(f.world));
 const audit=async()=>{await f.write('out/scene-bindings.json',s);return auditRobotProject(await f.load());};
 expect((await audit()).canLoad).toBe(true);
 s.robot.part.local[3]=.0508;
 const bad=await audit();expect(bad.canLoad).toBe(false);expect(bad.errors.join(' ')).toContain('50.800 mm');
 s.axisChecks[0].point=[-.0508,0,0];expect((await audit()).canLoad).toBe(true);
 s.axisChecks[0].joint='missing';expect((await audit()).canLoad).toBe(false);
 s.axisChecks[0].joint=j.id;s.axisChecks[0].toleranceM=0;expect((await audit()).canLoad).toBe(false);
}));
