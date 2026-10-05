import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {readRobotProject} from '../lib/robot-project.js';
import {javaExecutable} from '../lib/java-runtime.js';
if(!process.argv[2])throw Error('Pass the integrated robot.sim.json containing the team LimelightHelpers/JDK/JNI dependencies');
const project=await readRobotProject(process.argv[2]),java=await javaExecutable(project);
const javac=path.join(path.dirname(java),process.platform==='win32'?'javac.exe':'javac');
const root=path.resolve(import.meta.dir,'..'),output=await mkdtemp(path.join(os.tmpdir(),'cadcove-vision-tests-'));
try{
 for(const command of [
  [javac,'-cp',project.runtime.jar,'-d',output,path.join(root,'bridge/java/org/instantcad/frc/SimVision.java'),path.join(root,'tests/SimVisionTest.java')],
  [java,'-Djava.library.path='+project.runtime.nativeLibraries,'-cp',output+path.delimiter+project.runtime.jar,'org.instantcad.frc.SimVisionTest'],
 ]){const child=Bun.spawn(command,{cwd:output,stdout:'inherit',stderr:'inherit'}),timer=setTimeout(()=>child.kill(),60000);try{if(await child.exited)throw Error('Vision contract test failed');}finally{clearTimeout(timer);}}
}finally{await rm(output,{recursive:true,force:true});}
