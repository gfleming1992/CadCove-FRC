import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {packageTeamExample,unpackTeamExample,validateTeamPack} from '../lib/team-example.js';
import {hash,readRobotProject,auditRobotProject} from '../lib/robot-project.js';
test.each(['assets','project'])('example export relocates robot and field with %s source inputs and excludes live secrets',async sourceRoot=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'cadcove-example-export-')),root=path.join(temp,'source'),out=path.join(temp,'export');
 try{
  for(const d of ['cad','field','compiled','code/src','code/jni','code/.wpilib','code/.cadcove','bridge/java','colliders'])await mkdir(path.join(root,d),{recursive:true});
  const put=(f,v)=>writeFile(path.join(root,f),typeof v==='string'?v:JSON.stringify(v));
  const collision='synthetic-collision',world={bodies:[{id:'chassis',colliders:[{kind:'mesh_file',file:'colliders/part.ctm',sha256:hash(collision)}]}],joints:[],motors:[]};
  await put('colliders/part.ctm',collision);await put('compiled/world.json',world);
  await put('cad/model.js','original CAD source');
  await put('compiled/scene-bindings.json',{schema:1,start:[0,0,0],fieldOrigin:[0,0,0],worldHash:hash(JSON.stringify(world)),sourceHash:'robot-a',fieldSourceHash:'field-b',sourceInputs:{schema:1,root:sourceRoot,files:[{file:'cad/model.js',sha256:hash('original CAD source')}]},robot:{part:{body:'chassis',local:[1,0,0,0,0,1,0,0,0,0,1,0]}},field:{}});
  for(const [dir,sourceHash] of [['cad','robot-a'],['field','field-b']]){await put(dir+'/assembly.json',{sourceHash});await put(dir+'/instances.json',dir==='cad'?[{id:'part'}]:[]);}
  await put('code/build.gradle','apply from: "../../bridge/instantcad.gradle"');await put('code/src/Robot.java','example source');await put('code/.wpilib/wpilib_preferences.json',{teamNumber:123});await put('code/robot.jar','test jar; never executed');await put('code/jni/library','test native; never executed');await put('code/.cadcove/session.json','SECRET');await put('compiled/session.json','SECRET');await put('bridge/java/Adapter.java','example adapter');
  await put('profile.json',{schema:1,id:'different-robot',name:'Swappable fixture',practiceInput:{driverPort:1},cad:{robot:'cad',field:'field'},build:'compiled',runtime:{adapter:'wpilib-java-phoenix6',project:'code',jar:'code/robot.jar',nativeLibraries:'code/jni'},calibration:[]});
  await put('components.json',{schema:1,components:[{family:'drive-wheel',model:'Independent fixture wheel',status:'measured'}]});
  const args=[process.execPath,path.resolve(import.meta.dir,'../scripts/export-example-workspace.js'),'--project',path.join(root,'profile.json'),'--asset-root',root,'--bridge-source',path.join(root,'bridge'),'--component-catalog',path.join(root,'components.json'),'--output',out];
  const child=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(code).toBe(0);expect(stderr).toBe('');expect(JSON.parse(stdout).qualification).toBe('artifact-audit-only');
  const project=await readRobotProject(path.join(out,'robot.sim.json'));expect((await auditRobotProject(project)).canLoad).toBe(true);expect(project.runtime.project).toBe(path.join(out,'robot-code'));
  const editor=JSON.parse(await readFile(path.join(out,'.cadcove/project.json'),'utf8'));
  expect(editor.sourceDirectory).toBe('cad-assets/robot');expect(editor.entryPoint).toBe('model.js');
  expect(await readFile(path.join(out,editor.sourceDirectory,editor.entryPoint),'utf8')).toBe('original CAD source');
  expect(await readFile(path.join(out,'robot-code/.wpilib/wpilib_preferences.json'),'utf8')).toContain('123');expect(await readFile(path.join(out,'robot-code/build.gradle'),'utf8')).not.toContain('../../bridge');
  expect(await readdir(path.join(out,'robot-code/.cadcove'))).toEqual(['bridge']);expect(await readdir(path.join(out,'build/cadcove'))).not.toContain('session.json');
  expect(await readFile(path.join(out,'physics-assets/colliders/part.ctm'),'utf8')).toBe(collision);
  const frc=JSON.parse(await readFile(path.join(out,'.cadcove/frc.json')));
  expect(frc.componentCatalog).toBe('.cadcove/example/components.json');
  expect(JSON.parse(await readFile(path.join(out,frc.componentCatalog))).components[0].model).toBe('Independent fixture wheel');
  expect(JSON.parse(await readFile(path.join(out,'example-provenance.json'))).files.some(f=>f.file===frc.componentCatalog)).toBe(true);
  const pack=path.join(temp,'team.cpack'),restored=path.join(temp,'restored');
  await packageTeamExample(out,pack);
  const imported=await unpackTeamExample(pack,restored);expect(imported.robotBuildRequired).toBe(false);
  expect((await auditRobotProject(await readRobotProject(imported.project))).canLoad).toBe(true);
  expect(await readFile(path.join(restored,'robot-code/src/Robot.java'),'utf8')).toBe('example source');
  await expect(unpackTeamExample(pack,restored)).rejects.toThrow('already exists');
  const corrupt=await readFile(pack);corrupt[corrupt.length-1]^=1;await writeFile(pack,corrupt);
  await expect(unpackTeamExample(pack,path.join(temp,'corrupt'))).rejects.toThrow('checksum');
  expect((await readdir(temp)).includes('corrupt')).toBe(false);
  expect(()=>validateTeamPack({schema:1,id:'team3310-rebuilt',target:process.platform+'-'+process.arch,files:[{path:'../escape',bytes:1,sha256:'0'.repeat(64),executable:false}]})).toThrow('entry');
  const again=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});await new Response(again.stderr).text();expect(await again.exited).not.toBe(0);
  expect(await readFile(path.join(out,'robot-code/src/Robot.java'),'utf8')).toBe('example source');
  expect(await readFile(path.join(out,sourceRoot==='project'?'cad/model.js':'physics-assets/cad/model.js'),'utf8')).toBe('original CAD source');
  await writeFile(path.join(out,sourceRoot==='project'?'cad/model.js':'physics-assets/cad/model.js'),'changed source');
  const stale=await auditRobotProject(project);expect(stale.canLoad).toBe(false);expect(stale.sourceFreshness.status).toBe('stale');
 }finally{await rm(temp,{recursive:true,force:true});}
});
