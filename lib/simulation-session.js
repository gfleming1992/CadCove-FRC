import path from 'node:path';
import {readFile,writeFile,mkdir,rm,unlink,access,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {auditRobotProject} from './robot-project.js';
import {nativeExecutable} from './runtime-location.js';
import {javaExecutable} from './java-runtime.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
import {sessionFile,readSession,sessionRequest} from './simulation-client.js';
export {sessionFile,readSession,sessionRequest} from './simulation-client.js';

export async function recoverSimulation(project){
 const lock=path.join(project.build,'.cadcove-session-lock');
 // Serialize recovery so a second recovery cannot delete a new launcher's
 // lock after the first recovery has finished. A crashed recovery is manual.
 const recovery=path.join(lock,'recovery');
 try{await writeFile(recovery,String(process.pid),{flag:'wx',mode:0o600});}
 catch(error){if(error.code==='EEXIST')throw Error('Session recovery is already claimed; inspect the lock before manual recovery.');throw error;}
 try{
 let record;try{record=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));}catch(error){if(error.code==='ENOENT')throw Error('No readable launcher lock; inspect the build directory before manual recovery.');throw error;}
 if(record.schema!==1||!Number.isSafeInteger(record.pid)||record.pid<1||!/^[a-f0-9-]{36}$/.test(record.owner)||await realpath(record.project)!==await realpath(project.profilePath))throw Error('Invalid launcher lock; refusing recovery');
 const stopped=pid=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}};
 if(!stopped(record.pid))throw Error('The simulation launcher is still running; use sim-stop instead.');
 let session;try{session=await readSession(project);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(session&&(session.owner!==record.owner||!Number.isSafeInteger(session.pid)||session.pid<1))throw Error('Session identity does not match the stale lock');
 if(session&&!stopped(session.pid))throw Error('The robot program is still running; use sim-stop before recovery.');
 if(session)await unlink(sessionFile(project));
 await rm(lock,{recursive:true});
 return {schema:1,ok:true,command:'sim-recover',recovered:true};
 }finally{await unlink(recovery).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

async function probeNative(binary,gameplay){
 const child=Bun.spawn([binary],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
 child.stdin.write('{"op":"capabilities"}\n');child.stdin.end();
 const timer=setTimeout(()=>child.kill(),5000);
 try{
  const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
  const info=JSON.parse(out);
  if(code||!info.ok||gameplay&&!info.features?.includes('gameplay-mechanisms-v1')||gameplay?.field_conveyors?.length&&!info.features?.includes('practice-field-conveyors-v1')||gameplay?.storage_slots?.length&&!info.features?.includes('practice-cargo-contacts-v1'))throw Error(err||'Native simulator capabilities do not match the selected physics profile');
 }finally{clearTimeout(timer);}
}

// Load exactly one WPILib input provider. Agent runs are headless and own no
// HAL extension; DS runs never accept the bridge's synthetic input stream.
export async function driverStationLaunch(project,platform=process.platform){
 const source=project.profile.runtime.controlSource??'agent';
 if(!['agent','driverstation'].includes(source))throw Error('Unsupported control source');
 if(source==='agent')return {source,args:[],extensions:''};
 const provider=project.profile.runtime.driverStation??'gui';
 if(!['gui','socket'].includes(provider))throw Error('Unsupported Driver Station provider');
 const name=provider==='gui'?'halsim_gui':'halsim_ds_socket';
 const library=path.join(project.runtime.nativeLibraries,platform==='win32'?name+'.dll':'lib'+name+(platform==='darwin'?'.dylib':'.so'));
 await access(library,constants.R_OK);
 return {source,args:platform==='darwin'&&provider==='gui'?['-XstartOnFirstThread']:[],extensions:library};
}

export async function runSimulation(project,{onReady=()=>{},signal,startupTimeout=process.platform==='win32'?120000:45000}={}){
 const audit=await auditRobotProject(project);if(!audit.canLoad)throw Error(audit.errors.join('; '));
 const java=await javaExecutable(project),native=nativeExecutable(),input=await driverStationLaunch(project);
 for(const file of [java,native,project.runtime.jar])await access(file,file===project.runtime.jar?constants.R_OK:constants.X_OK);
 await probeNative(native,project.profile.physicsMode?.settings?.gameplay);
 await mkdir(project.build,{recursive:true});
 const lock=path.join(project.build,'.cadcove-session-lock'),owner=randomUUID();
 try{await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw Error('This project already has a simulation launcher or a stale lock. Inspect '+lock+' before starting another run.');throw error;}
 let child,stopTimer,ended=false;
 const stop=async()=>{
  if(!child||ended)return;
  try{if((await readSession(project)).owner!==owner)throw Error('Session owner changed');await sessionRequest(project,'shutdown',{body:{},timeout:1000});}catch{child.kill('SIGTERM');}
  clearTimeout(stopTimer);stopTimer=setTimeout(()=>{if(child&&!ended)child.kill('SIGKILL');},10000);stopTimer.unref();
 };
 try{
  await writeFile(path.join(lock,'owner.json'),JSON.stringify({schema:1,pid:process.pid,owner,project:project.profilePath}),{flag:'wx',mode:0o600});
  await unlink(sessionFile(project)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  const token=randomBytes(32).toString('hex');
  const assetRoot=project.profile.runtime.assetRoot?path.resolve(project.root,project.profile.runtime.assetRoot):project.root;
  const env={...process.env,HALSIM_EXTENSIONS:input.extensions,INSTANTCAD_CONTROL_SOURCE:input.source,INSTANTCAD_SIM:'1',INSTANTCAD_ROOT:assetRoot,INSTANTCAD_PROJECT:project.profilePath,INSTANTCAD_BUILD:project.build,INSTANTCAD_WORLD:path.join(project.build,'world.json'),INSTANTCAD_SIM_BINARY:native,INSTANTCAD_BRIDGE_PORT:'0',INSTANTCAD_ALLOW_RESET:'0',INSTANTCAD_CLOCK:project.profile.runtime.clock||'physics',INSTANTCAD_AUTO_CHOOSER:project.profile.runtime.autonomousChooser||'',CADCOVE_SESSION_FILE:sessionFile(project),CADCOVE_SESSION_TOKEN:token,CADCOVE_SESSION_OWNER:owner,CADCOVE_PROJECT_ID:project.profile.id,CADCOVE_LAUNCHER_PID:String(process.pid)};
  for(const name of ['DYLD_LIBRARY_PATH','LD_LIBRARY_PATH','PATH'])env[name]=[project.runtime.nativeLibraries,env[name]].filter(Boolean).join(path.delimiter);
  child=spawn(java,[...input.args,'-Djava.library.path='+project.runtime.nativeLibraries,'-jar',project.runtime.jar],{cwd:project.runtime.project,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',bytes=>process.stderr.write(bytes));child.stderr.on('data',bytes=>process.stderr.write(bytes));
  let launchError,code;
  const exited=new Promise(resolve=>{child.once('error',error=>{launchError=error;ended=true;resolve();});child.once('exit',value=>{ended=true;code=value;resolve();});});
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)await stop();
  const until=Date.now()+startupTimeout;let ready=false;
  while(!ended&&!signal?.aborted&&Date.now()<until){
   let session;try{session=await readSession(project);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(session){if(session.owner!==owner)throw Error('A different launcher published this project session');if(session.launcherPid!==process.pid)throw Error('Robot bridge lacks current launcher ownership protection. Export/review the current bridge sources and rebuild the robot JAR.');const state=await sessionRequest(project,'state');if(state.error)throw Error(state.error);if(input.source==='driverstation'&&state.controlSource!=='driverstation')throw Error('Robot JAR lacks Driver Station input support; rebuild it with the current bridge');await onReady({schema:1,ok:true,event:'simulation-ready',project:project.profilePath,runId:session.runId,worldHash:session.worldHash,endpoint:session.endpoint,reviewRequired:audit.reviewRequired});ready=true;break;}
   await delay(50);
  }
  if(launchError)throw launchError;
  if(!ready&&!signal?.aborted)throw Error(ended?`Robot exited before its managed bridge became ready (${code})`:'Bridge startup timed out. Rebuild the robot with the current CadCove bridge and inspect its launch diagnostics.');
  await exited;
  return {schema:1,ok:code===0,event:'simulation-stopped',exitCode:code};
 }finally{
  signal?.removeEventListener('abort',stop);
  if(child&&!ended){await stop();if(!ended)await new Promise(resolve=>{
   const done=()=>{clearTimeout(timer);child.off('exit',done);resolve();};
   const timer=setTimeout(done,11000);child.once('exit',done);
  });}
  clearTimeout(stopTimer);
  try{const session=JSON.parse(await readFile(sessionFile(project),'utf8'));if(session.owner===owner)await unlink(sessionFile(project));}
  catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  finally{await rm(lock,{recursive:true,force:true});}
 }
}
