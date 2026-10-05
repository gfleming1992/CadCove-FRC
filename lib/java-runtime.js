import path from 'node:path';
import os from 'node:os';
import {access,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';

export async function javaExecutable(project,env=process.env){
 const executable=process.platform==='win32'?'java.exe':'java';
 const explicit=env.INSTANTCAD_JDK||(project.profile.runtime.jdk?path.resolve(project.root,project.profile.runtime.jdk):undefined)||env.JAVA_HOME;
 if(explicit)return path.join(explicit,'bin',executable);
 const roots=[path.join(os.homedir(),'wpilib'),...(env.PUBLIC?[path.join(env.PUBLIC,'wpilib')]:[])];
 for(const root of roots){
  let entries=[];try{entries=await readdir(root,{withFileTypes:true});}catch{}
  const years=entries.filter(e=>e.isDirectory()&&/^20\d{2}$/.test(e.name)).map(e=>e.name).sort().reverse();
  for(const year of years){const file=path.join(root,year,'jdk','bin',executable);try{await access(file,constants.X_OK);return file;}catch{}}
 }
 throw Error('WPILib JDK not found; set runtime.jdk in robot.sim.json or INSTANTCAD_JDK to the installed JDK directory.');
}
