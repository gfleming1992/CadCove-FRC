// A verified, platform-specific content pack. CAD/season/vendor assets remain
// separate from the generic source release; no download or execution on export.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {open,lstat,readFile,writeFile,mkdir,mkdtemp,realpath,readdir,cp} from 'node:fs/promises';
import {runtimeRoot,bundledRuntime,runtimeVersion} from './runtime-location.js';
import {readRobotProject,auditRobotProject} from './robot-project.js';
import {removeStagingDirectory} from './directory-publish.js';
const magic=Buffer.from('CCEX0001'),maxTotal=1024**3;
export function validateTeamPack(m,target=`${process.platform}-${process.arch}`){
 if(m?.schema!==1||m.id!=='team3310-rebuilt'||m.target!==target||!Array.isArray(m.files)||!m.files.length||m.files.length>20000)throw Error('Invalid or incompatible team example pack');
 const seen=new Set();let total=0;
 for(const f of m.files){
  if(typeof f.path!=='string'||f.path.length>500||f.path.includes('\\')||f.path.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f:]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||seen.has(f.path.toLowerCase())||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>256*1024**2||!/^[a-f0-9]{64}$/.test(f.sha256)||typeof f.executable!=='boolean')throw Error('Invalid team example entry');
  seen.add(f.path.toLowerCase());total+=f.bytes;
 }
 if(total>maxTotal)throw Error('Team example too large');
 for(const name of ['robot.sim.json','.cadcove/project.json','build/cadcove/world.json','build/cadcove/scene-bindings.json','robot-code/build/libs/robot.jar'])if(!seen.has(name))throw Error('Team example missing '+name);
 return total;
}
export async function packageTeamExample(source,destination){
 const root=await realpath(source),files=[];
 const audit=await auditRobotProject(await readRobotProject(path.join(root,'robot.sim.json')));
 if(!audit.canLoad)throw Error('Team example audit failed before packaging: '+audit.errors.join('; '));
 const profile=JSON.parse(await readFile(path.join(root,'robot.sim.json')));
 if(![0,1].includes(profile.practiceInput?.driverPort))throw Error('Team example requires an explicit practiceInput.driverPort');
 async function walk(relative=''){
  for(const e of (await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=relative?relative+'/'+e.name:e.name,p=path.join(root,name);
   if(e.isDirectory())await walk(name);
   else {const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('Pack requires regular files');const b=await readFile(p);files.push({path:name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),executable:!!(s.mode&0o111)});}
  }
 }
 await walk();const manifest={schema:1,id:'team3310-rebuilt',name:'Team 3310 Amarillo — REBUILT practice',target:`${process.platform}-${process.arch}`,publicRedistributionReady:false,files};validateTeamPack(manifest);
 const header=Buffer.from(JSON.stringify(manifest)),prefix=Buffer.alloc(12);magic.copy(prefix);prefix.writeUInt32LE(header.length,8);
 const out=await open(destination,'wx');
 try{await out.writeFile(prefix);await out.writeFile(header);for(const f of files){const bytes=await readFile(path.join(root,f.path));if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Example changed during packaging');await out.writeFile(bytes);}}finally{await out.close();}
 return {files:files.length,bytes:validateTeamPack(manifest),target:manifest.target};
}
export async function unpackTeamExample(pack,workspace){
 const requested=path.resolve(workspace),parent=await realpath(path.dirname(requested)),output=path.join(parent,path.basename(requested));
 try{await lstat(output);throw Error('Example workspace already exists; choose a new directory');}catch(e){if(e.code!=='ENOENT')throw e;}
 const stat=await lstat(pack);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxTotal+8*1024**2+12)throw Error('Invalid team pack file');
 const file=await open(pack,'r');let stage;
 async function exact(bytes,position){const data=Buffer.alloc(bytes);let done=0;while(done<bytes){const r=await file.read(data,done,bytes-done,position+done);if(!r.bytesRead)throw Error('Truncated team example pack');done+=r.bytesRead;}return data;}
 try{
  const prefix=await exact(12,0),size=prefix.readUInt32LE(8);if(!prefix.subarray(0,8).equals(magic)||size<1||size>8*1024**2)throw Error('Invalid team pack header');
  const manifest=JSON.parse(await exact(size,12)),total=validateTeamPack(manifest);if(stat.size!==12+size+total)throw Error('Team pack length mismatch');
  stage=await mkdtemp(path.join(parent,'.cadcove-team-'));let offset=12+size;
  for(const f of manifest.files){const bytes=await exact(f.bytes,offset);offset+=f.bytes;if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Team pack checksum mismatch: '+f.path);const target=path.join(stage,f.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx',mode:f.executable?0o755:0o644});}
  const project=await readRobotProject(path.join(stage,'robot.sim.json'));if(![0,1].includes(project.profile.practiceInput?.driverPort))throw Error('Team example is missing its driver controller mapping');const audit=await auditRobotProject(project);if(!audit.canLoad)throw Error('Team example audit failed: '+audit.errors.join('; '));
  await mkdir(output);for(const e of await readdir(stage))await cp(path.join(stage,e),path.join(output,e),{recursive:true,force:false,errorOnExist:true});
  return {schema:1,ok:true,command:'example-create',workspace:output,example:manifest.id,project:path.join(output,'robot.sim.json'),runtimeVersion,cadReady:true,robotBuildRequired:false,hardwareQualified:false,publicRedistributionReady:manifest.publicRedistributionReady,next:['Open this workspace in VS Code/WPILib.','Run CadCove: Start Robot Simulation, then CadCove: Open Live Simulation. Map controllers and enable in WPILib Sim GUI.','The matching WPILib JDK must be installed; robot JAR and platform vendor libraries are included.']};
 }finally{await file.close();if(stage)await removeStagingDirectory(stage);}
}
export async function createTeamExample(workspace){
 if(!workspace)throw Error('Use --workspace NEW_DIRECTORY');
 const pack=path.join(runtimeRoot,...(bundledRuntime?[]:['build']),'team-example.cpack');
 try{return await unpackTeamExample(pack,workspace);}catch(e){if(e.code==='ENOENT'&&e.path===pack)throw Error('Install the Team Robot edition of CadCove; this runtime does not include the team content pack.');throw e;}
}
