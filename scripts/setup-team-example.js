// Explicit, reproducible example setup. Never imports the developer workspace.
import path from 'node:path';
import {mkdir,readFile,writeFile,cp,lstat,rename,rm,mkdtemp,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {readRobotProject,auditRobotProject} from '../lib/robot-project.js';
import {javaExecutable} from '../lib/java-runtime.js';
const args=process.argv.slice(2),options={};
while(args.length){const k=args.shift();if(k==='--skip-robot-build'){options[k]=true;continue;}if(!['--output','--field-step'].includes(k)||!args.length||options[k])throw Error('Usage: bun scripts/setup-team-example.js --output NEW_WORKSPACE [--field-step FILE] [--skip-robot-build]');options[k]=args.shift();}
if(!options['--output'])throw Error('--output NEW_WORKSPACE is required');
const repo=path.resolve(import.meta.dir,'..'),example=path.join(repo,'examples/team3310-rebuilt'),output=path.resolve(options['--output']);
if(output===repo||repo.startsWith(output+path.sep))throw Error('Output cannot contain the source repository');
try{await lstat(output);throw Error('Output exists; choose a new directory. Existing projects are never overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
const hash=b=>createHash('sha256').update(b).digest('hex'),json=async f=>JSON.parse(await readFile(f));
const pin=await json(path.join(example,'field-source.json'));
const cache=path.join(repo,'build/example-downloads',pin.sha256+'.step');
let fieldFile=options['--field-step']?path.resolve(options['--field-step']):cache;
if(!options['--field-step']){
 let valid=false;try{const b=await readFile(cache);valid=b.length===pin.bytes&&hash(b)===pin.sha256;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!valid){
  console.error('Downloading REBUILT field directly from FIRST (cached after checksum verification)…');
  const response=await fetch(pin.url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('FIRST download failed: '+response.status);
  const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>pin.bytes)throw Error('Field exceeds pinned size');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(bytes.length!==pin.bytes||hash(bytes)!==pin.sha256)throw Error('FIRST field revision changed; update/review example bindings before importing');
  await mkdir(path.dirname(cache),{recursive:true});await writeFile(cache,bytes);
 }
}
const fieldBytes=await readFile(fieldFile);if(fieldBytes.length!==pin.bytes||hash(fieldBytes)!==pin.sha256)throw Error('Field STEP does not match the reviewed REBUILT revision');
await mkdir(path.dirname(output),{recursive:true});const stage=await mkdtemp(path.join(path.dirname(output),'.cadcove-example-'));
const run=async(command,cwd=repo,env=process.env)=>{const p=Bun.spawn(command,{cwd,env,stdout:command[1]?.endsWith('build-example-field.js')?'ignore':'inherit',stderr:'inherit'});if(await p.exited)throw Error('Example setup failed: '+command[0]+' '+command[1]);};
try{
 console.error('Copying editable team CAD, robot source, and reviewed physics bindings…');
 await cp(path.join(example,'source'),stage,{recursive:true});
 await mkdir(path.join(stage,'build/cadcove'),{recursive:true});
 const field=path.join(stage,'cad-assets/field');
 await run([process.execPath,path.join(repo,'scripts/build-example-field.js'),fieldFile,field]);
 await run([process.execPath,path.join(repo,'scripts/extract-appearance.js'),field,fieldFile]);
 const catalog=await json(path.join(field,'catalog.json')),mapped=new Map();
 const colliderDir=path.join(stage,'physics-assets/build/colliders');await mkdir(colliderDir,{recursive:true});
 for(const [oldHash,asset] of Object.entries(pin.colliders)){
  const item=catalog[asset];if(!item)throw Error('Missing field collider prototype '+asset);
  const meshBytes=await readFile(path.join(field,item.mesh));if(hash(meshBytes)!==item.meshSha256)throw Error('Field mesh checksum mismatch');
  const {parts:[m]}=decodeScene(meshBytes.buffer.slice(meshBytes.byteOffset,meshBytes.byteOffset+meshBytes.byteLength));
  const bytes=Buffer.alloc(12+m.positions.byteLength+m.indices.byteLength);bytes.write('CTM1');bytes.writeUInt32LE(m.positions.length/3,4);bytes.writeUInt32LE(m.indices.length/3,8);
  for(let i=0;i<m.positions.length;i++)bytes.writeFloatLE(m.positions[i]/1000,12+i*4);
  for(let i=0;i<m.indices.length;i++)bytes.writeUInt32LE(m.indices[i],12+m.positions.byteLength+i*4);
  const digest=hash(bytes);await writeFile(path.join(colliderDir,digest+'.ctm'),bytes);mapped.set(oldHash,digest);
 }
 const world=await json(path.join(stage,'world.json')),scene=await json(path.join(stage,'scene-bindings.json')),profile=await json(path.join(stage,'robot.sim.json'));
 function replace(x){if(!x||typeof x!=='object')return;if(x.kind==='mesh_file'&&mapped.has(x.sha256)){x.sha256=mapped.get(x.sha256);x.file='build/colliders/'+x.sha256+'.ctm';}Object.values(x).forEach(replace);}replace(world);
 for(const input of scene.sourceInputs.files)if(input.file.startsWith('physics-assets/build/colliders/')&&mapped.has(input.sha256)){input.sha256=mapped.get(input.sha256);input.file='physics-assets/build/colliders/'+input.sha256+'.ctm';}
 const worldBytes=Buffer.from(JSON.stringify(world));scene.worldHash=hash(worldBytes);profile.physicsMode.worldHash=scene.worldHash;
 await writeFile(path.join(stage,'build/cadcove/world.json'),worldBytes);await writeFile(path.join(stage,'build/cadcove/scene-bindings.json'),JSON.stringify(scene));
 await rm(path.join(stage,'robot.sim.json')); 
 await rm(path.join(stage,'world.json'));await rm(path.join(stage,'scene-bindings.json'));
 await initializeToolbox({workspace:stage,id:'team3310-rebuilt',name:profile.name,cadDirectory:'cad-assets/robot',buildDirectory:'build/cadcove'});
 await writeFile(path.join(stage,'robot.sim.json'),JSON.stringify(profile,null,2)+'\n');
 await cp(path.join(example,'components.json'),path.join(stage,'.cadcove/example/components.json'));
 await writeFile(path.join(stage,'.cadcove/frc.json'),JSON.stringify({schema:1,example:'team3310-rebuilt',componentCatalog:'.cadcove/example/components.json',seasonKnowledge:null,componentPreference:['CTRE Phoenix 6','WCP','Limelight']},null,2)+'\n');
 const audit=await auditRobotProject(await readRobotProject(path.join(stage,'robot.sim.json')));if(!audit.canLoad)throw Error('Example audit failed: '+audit.errors.join('; '));
 if(!options['--skip-robot-build']){
  const project=await readRobotProject(path.join(stage,'robot.sim.json')),java=await javaExecutable(project),jdk=path.dirname(path.dirname(java));
  const cwd=path.join(stage,'robot-code');await chmod(path.join(cwd,'gradlew'),0o755);
  console.error('Building team robot and resolving WPILib/CTRE libraries for '+process.platform+'-'+process.arch+'…');
  const gradle=process.platform==='win32'?['cmd.exe','/d','/c','gradlew.bat']:['./gradlew'];
  await run([...gradle,'--no-daemon','jar','extractReleaseNative','-x','spotlessJava','-x','spotlessGroovyGradle','-x','spotlessJson','-x','spotlessMisc'],cwd,{...process.env,JAVA_HOME:jdk,PATH:path.join(jdk,'bin')+path.delimiter+process.env.PATH});
  if(!(await lstat(path.join(cwd,'build/libs/robot.jar'))).isFile())throw Error('Robot build did not produce robot.jar');
 }
 await writeFile(path.join(stage,'example-setup.json'),JSON.stringify({schema:1,example:'team3310-rebuilt',fieldUrl:pin.url,fieldSha256:pin.sha256,worldHash:scene.worldHash,robotBuilt:!options['--skip-robot-build'],platform:process.platform,architecture:process.arch,fieldColliderHashesChanged:[...mapped].filter(([a,b])=>a!==b).length,audit},null,2)+'\n');
 await writeFile(path.join(stage,'README.md'),'# Team 3310 Amarillo on REBUILT\n\nOpen this folder in VS Code with CadCove installed. Run **CadCove: Open Robot CAD** or **CadCove: Open Live Simulation**. Map controllers in WPILib Sim GUI (driver 1, operator 0) and enable Teleoperated.\n\nRobot code is under robot-code; editable CAD is under cad-assets/robot. FIRST field geometry was downloaded and rebuilt locally. Review calibration in robot.sim.json. This workspace is for simulation; its team number defaults to 0.\n');
 await rename(stage,output);
 console.log(JSON.stringify({ok:true,workspace:output,project:path.join(output,'robot.sim.json'),robotBuilt:!options['--skip-robot-build'],audit:true}));
}finally{await rm(stage,{recursive:true,force:true});}
