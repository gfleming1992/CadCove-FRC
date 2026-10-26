// Uses the team's installed WPILib/Phoenix/Jackson dependencies, never downloads SDKs.
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {javaExecutable} from '../lib/java-runtime.js';
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift(),value=args.shift();if(!['--classpath','--native-binary','--native-libraries','--jdk'].includes(key)||!value||options[key])throw Error('Expected --classpath JARS --native-binary FILE [--native-libraries DIRECTORY] [--jdk DIRECTORY]');options[key]=value;}
if(!options['--classpath']||!options['--native-binary'])throw Error('--classpath and --native-binary are required');
options['--classpath']=options['--classpath'].split(path.delimiter).map(p=>path.resolve(p)).join(path.delimiter);
const root=path.resolve(import.meta.dir,'..'),directory=await mkdtemp(path.join(os.tmpdir(),'cadcove-device-tests-'));
const java=await javaExecutable({root,profile:{runtime:{...(options['--jdk']?{jdk:options['--jdk']}:{})}}}),javac=path.join(path.dirname(java),process.platform==='win32'?'javac.exe':'javac');
async function run(command,env={}){
 const child=Bun.spawn(command,{cwd:directory,env:{...process.env,INSTANTCAD_SIM:'1',HALSIM_EXTENSIONS:'',...env},stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),60000);
 try{const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);if(code)throw Error(`Device contract failed (${code}): ${out}\n${err}`);return out.trim();}finally{clearTimeout(timer);}
}
try{
 const bridge=path.join(root,'bridge/java/org/instantcad/frc');
 // Compile the full shipped bridge to detect SDK/API drift, not just adapter classes.
 const sources=(await readdir(bridge)).filter(n=>n.endsWith('.java')&&n!=='ShotTuning.java').map(n=>path.join(bridge,n));
 sources.push(path.join(root,'tests/MotorAdapterTest.java'),path.join(root,'tests/PhoenixAdapterTest.java'),path.join(root,'tests/MotorBridgeTest.java'));
 await run([javac,'-cp',options['--classpath'],'-d',directory,...sources]);
 const classpath=directory+path.delimiter+options['--classpath'];
 const native=await run([java,'-cp',classpath,'org.instantcad.frc.MotorAdapterTest',path.resolve(options['--native-binary'])]);
 const phoenix=options['--native-libraries']?await run([java,'-Djava.library.path='+path.resolve(options['--native-libraries']),'-cp',classpath,'org.instantcad.frc.PhoenixAdapterTest']):null;
 const bridgeResult=[];
 for(const controlSource of ['agent','driverstation'])bridgeResult.push(options['--native-libraries']?await run([java,'-Djava.library.path='+path.resolve(options['--native-libraries']),'-cp',classpath,'org.instantcad.frc.MotorBridgeTest'],{
  INSTANTCAD_CONTROL_SOURCE:controlSource,INSTANTCAD_ALLIANCE_STATION:'Red2',INSTANTCAD_ROOT:directory,INSTANTCAD_BUILD:directory,INSTANTCAD_WORLD:path.join(directory,'world.json'),INSTANTCAD_SIM_BINARY:path.resolve(options['--native-binary']),INSTANTCAD_CLOCK:'wall',INSTANTCAD_BRIDGE_PORT:'0',
  CADCOVE_SESSION_FILE:path.join(directory,'session.json'),CADCOVE_SESSION_TOKEN:randomBytes(32).toString('hex'),CADCOVE_SESSION_OWNER:randomUUID(),INSTANTCAD_PROJECT:path.join(directory,'robot.sim.json'),CADCOVE_PROJECT_ID:'device-contract'
 }):null);
 console.log(JSON.stringify({ok:true,fullBridgeCompile:true,nativeClosedLoop:true,phoenixJNI:phoenix!==null,bridgeLifecycle:bridgeResult!==null,native,phoenix,bridge:bridgeResult}));
}finally{await rm(directory,{recursive:true,force:true});}
