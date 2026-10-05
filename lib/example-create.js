import path from 'node:path';
import {createTeamExample} from './team-example.js';
import {readFile,writeFile,mkdir,lstat,realpath,mkdtemp,rm,cp,readdir} from 'node:fs/promises';
import {bundledRuntime,runtimeRoot,runtimeVersion} from './runtime-location.js';
import {decodeExampleBundle,exampleDigest} from './example-bundle.js';
import {initializeToolbox} from './toolbox-project.js';
import {exportBridge} from './bridge-export.js';

export async function createExample({workspace,example='team3310-rebuilt',phoenixDescriptor}){
 if(example==='team3310-rebuilt')return createTeamExample(workspace);
 if(!workspace||example!=='training-robot')throw Error('Use --workspace NEW_DIRECTORY --example training-robot; existing team projects are never replaced');
 const requested=path.resolve(workspace),parent=await realpath(path.dirname(requested)),output=path.join(parent,path.basename(requested));
 try{await lstat(output);throw Error('Example workspace already exists; choose a new directory');}catch(e){if(e.code!=='ENOENT')throw e;}
 const bundleFile=path.join(runtimeRoot,...(bundledRuntime?[]:['build']),'training-example.json');
 let bytes;try{const s=await lstat(bundleFile);if(!s.isFile()||s.isSymbolicLink()||s.size>8*1024*1024)throw Error('Invalid installed example bundle');bytes=await readFile(bundleFile);}catch(e){if(e.code==='ENOENT')throw Error('Training bundle is missing. Repair the runtime; source checkouts must run scripts/package-training-example.js --output build/training-example.json first.');throw e;}
 const files=decodeExampleBundle(JSON.parse(bytes));let descriptor;
 if(phoenixDescriptor){
  const s=await lstat(phoenixDescriptor);if(!s.isFile()||s.isSymbolicLink()||s.size>1024*1024)throw Error('Invalid Phoenix descriptor file');
  descriptor=await readFile(phoenixDescriptor);const vendor=JSON.parse(descriptor);
  if(vendor.version!=='26.1.3'||String(vendor.frcYear)!=='2026'||vendor.uuid!=='e995de00-2c64-4df5-8831-c1441420ff19')throw Error('Training example requires the official Phoenix 6 26.1.3 / 2026 descriptor');
 }
 // Assemble privately before reserving the new destination. There are no JARs,
 // native vendor libraries, automatic downloads or robot execution here.
 const stage=await mkdtemp(path.join(parent,'.cadcove-example-'));
 try{
  await initializeToolbox({workspace:stage,id:'training-robot',name:'CadCove training robot'});
  await exportBridge(stage);
  for(const [relative,data] of files){
   const file=path.join(stage,relative==='training-profile.json'?'robot.sim.json':relative);
   await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data);
  }
  if(descriptor){await mkdir(path.join(stage,'vendordeps'));await writeFile(path.join(stage,'vendordeps/Phoenix6.json'),descriptor);}
  const configFile=path.join(stage,'.cadcove/frc.json'),config=JSON.parse(await readFile(configFile,'utf8'));config.example='training-robot';config.season='example.training-zone';await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
  await writeFile(path.join(stage,'.gitignore'),'/build/\n/.gradle/\n/.cadcove/knowledge/\n');
  await writeFile(path.join(stage,'example-provenance.json'),JSON.stringify({schema:1,id:'training-robot',runtimeVersion,bundleSha256:exampleDigest(bytes),files:[...files].map(([file,data])=>({file:file==='training-profile.json'?'robot.sim.json':file,sha256:exampleDigest(data)})),phoenixDescriptorSha256:descriptor?exampleDigest(descriptor):null,hardwareQualified:false},null,2)+'\n');
  // mkdir is exclusive, unlike rename-over-an-empty-directory. Never replace an
  // existing workspace, even if another command created it during preparation.
  await mkdir(output);
  for(const file of await readdir(stage))await cp(path.join(stage,file),path.join(output,file),{recursive:true,force:false,errorOnExist:true});
 }finally{await rm(stage,{recursive:true,force:true});}
 return {schema:1,ok:true,command:'example-create',workspace:output,example,project:path.join(output,'robot.sim.json'),cadReady:true,robotBuildRequired:true,hardwareQualified:false,phoenixDescriptorIncluded:!!descriptor,next:[
  'Open this workspace in VS Code/WPILib and use CadCove: Open CAD Model. The CAD source and simulation view meshes are already present.',
  ...(descriptor?[]:['Copy the official installed Phoenix 6 26.1.3 descriptor to vendordeps/Phoenix6.json.']),
  'With the WPILib 2026 JDK and Gradle 8.11, run: gradle --no-daemon jar extractReleaseNative',
  'cadcove doctor --project robot.sim.json',
  'Start with CadCove: Start Robot Simulation, then CadCove: Open Live Simulation; or run cadcove sim-run --project robot.sim.json.',
 ]};
}
