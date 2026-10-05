// Compiles the bridge against an integrated robot's JDK/vendor classpath, but
// never starts that robot, HAL, Phoenix, or their competing network services.
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,mkdir,writeFile,copyFile,readFile,access,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {sessionFile,sessionRequest} from '../lib/simulation-client.js';
import {nativeExecutable} from '../lib/runtime-location.js';
import {readRobotProject} from '../lib/robot-project.js';
import {javaExecutable} from '../lib/java-runtime.js';
if(!process.argv[2])throw Error('Pass an integrated robot.sim.json for its JDK and Jackson classpath');
if(process.argv.length>3&&(process.argv.length!==5||process.argv[3]!=='--runtime'))throw Error('Optional --runtime DIRECTORY tests the packaged CLI');
const runtime=process.argv[4]?path.resolve(process.argv[4]):null;
const project=await readRobotProject(process.argv[2]),java=await javaExecutable(project);
const javac=path.join(path.dirname(java),process.platform==='win32'?'javac.exe':'javac');
const root=path.resolve(import.meta.dir,'..'),output=await mkdtemp(path.join(os.tmpdir(),'cadcove-managed-tests-'));
const classes=path.join(output,'classes');await mkdir(classes);
const cli=runtime?[path.join(runtime,'cadcove'+(process.platform==='win32'?'.exe':''))]:[process.execPath,path.join(root,'bin/cadcove.js')];
const native=runtime?path.join(runtime,'instantcad-sim'+(process.platform==='win32'?'.exe':'')):nativeExecutable();
const env={...process.env,INSTANTCAD_JDK:path.dirname(path.dirname(java)),INSTANTCAD_SIM_BINARY:native};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){const deadline=Date.now()+12000;while(!await predicate()){if(Date.now()>deadline)throw Error('Launcher ownership check timed out');await wait(40);}}
async function command(args){
 const p=Bun.spawn([...cli,...args],{cwd:output,env,stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>p.kill(),15000);
 try{const [text,error,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);return {text,error,code};}finally{clearTimeout(timer);}
}
try{
 if(runtime){const exported=await command(['bridge-export','--workspace',output]);assert.equal(exported.code,0,exported.text+'\n'+exported.error);}
 const bridge=path.join(runtime?output:root,runtime?'.cadcove/bridge/java/org/instantcad/frc':'bridge/java/org/instantcad/frc');
 const sources=(await readdir(bridge)).filter(n=>n.endsWith('.java')&&n!=='ShotTuning.java').map(n=>path.join(bridge,n));
 const tests=['ManagedSessionTest','LauncherWatchTest'];
 const commands=[
  [javac,'-cp',project.runtime.jar,'-d',classes,...sources,...tests.map(name=>path.join(root,'tests',name+'.java')),path.join(root,'tests/LauncherProtocolFixture.java')],
  ...tests.map(name=>[java,'-cp',classes+path.delimiter+project.runtime.jar,'org.instantcad.frc.'+name]),
 ];
 for(const command of commands){const child=Bun.spawn(command,{cwd:output,stdout:'inherit',stderr:'inherit'}),timer=setTimeout(()=>child.kill(),30000);try{if(await child.exited)throw Error('Managed session regression failed');}finally{clearTimeout(timer);}}
 const jar=path.join(output,'fixture.jar'),manifest=path.join(output,'fixture.mf');
 await writeFile(manifest,'Manifest-Version: 1.0\nMain-Class: org.instantcad.frc.LauncherProtocolFixture\nClass-Path: '+pathToFileURL(project.runtime.jar).href+'\n\n');
 const pack=Bun.spawn([path.join(path.dirname(java),process.platform==='win32'?'jar.exe':'jar'),'cfm',jar,manifest,'-C',classes,'.'],{stdout:'inherit',stderr:'inherit'});assert.equal(await pack.exited,0);
 const build=path.join(output,'build');await mkdir(build);
 for(const name of ['world.json','scene-bindings.json'])await copyFile(path.join(project.build,name),path.join(build,name));
 const profile={...project.profile,id:'ownership-regression',name:'Launcher protocol fixture',cad:project.cad,build,
  runtime:{...project.profile.runtime,project:output,jar,nativeLibraries:project.runtime.nativeLibraries,assetRoot:project.profile.runtime.assetRoot?path.resolve(project.root,project.profile.runtime.assetRoot):project.root}};
 const file=path.join(output,'robot.sim.json');await writeFile(file,JSON.stringify(profile));
 const owned=await readRobotProject(file);
 for(const mode of ['legacy','managed']){
  let session;const p=Bun.spawn([...cli,'sim-run','--project',file],{cwd:output,env:{...env,CADCOVE_OWNER_FIXTURE_MODE:mode},stdout:'pipe',stderr:'pipe'});
  let text='',error='',terminal=false;
  const stdout=(async()=>{for await(const chunk of p.stdout)text+=new TextDecoder().decode(chunk);})();
  const stderr=(async()=>{for await(const chunk of p.stderr)error+=new TextDecoder().decode(chunk);})();
  p.exited.then(()=>terminal=true);
  try{
   if(mode==='legacy'){
    await until(()=>terminal);await Promise.all([stdout,stderr]);
    assert.notEqual(p.exitCode,0);assert.match(text,/lacks current launcher ownership protection/);assert.doesNotMatch(text,/simulation-ready/);
    await assert.rejects(access(path.join(build,'.cadcove-session-lock')));
   }else{
    await until(()=>text.includes('simulation-ready')||terminal);assert.equal(terminal,false,text+'\n'+error);
    session=JSON.parse(await readFile(sessionFile(owned),'utf8'));assert.equal(session.launcherPid,p.pid);
    assert.equal(process.kill(session.pid,0),true);
    p.kill('SIGKILL');await p.exited;
    await until(()=>{try{process.kill(session.pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw e;}});
    const recovery=await command(['sim-recover','--project',file]);assert.equal(recovery.code,0,recovery.text+'\n'+recovery.error);assert.equal(JSON.parse(recovery.text).recovered,true);
    await assert.rejects(access(path.join(build,'.cadcove-session-lock')));await assert.rejects(access(sessionFile(owned)));
   }
  }finally{
   await sessionRequest(owned,'shutdown',{body:{},timeout:1000}).catch(()=>{});
   if(!terminal){p.kill('SIGTERM');await Promise.race([p.exited,wait(3000)]);if(!terminal)p.kill('SIGKILL');}
   await Promise.all([stdout,stderr,p.exited]);
  }
 }
 console.log(JSON.stringify({ok:true,packagedCLI:!!runtime,fullBridgeCompiled:true,packagedBridgeExport:!!runtime,legacyBridgeRejected:true,abruptLauncherDeathStopsOwnedJVM:true,staleRecovery:true,actualRobotOrVendorSDKStarted:false}));
}finally{await rm(output,{recursive:true,force:true});}
