import path from 'node:path';
import {readFile,mkdir,writeFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';

export async function bridgeSources(){
 if(bundledRuntime)return JSON.parse(await readFile(path.join(runtimeRoot,'bridge-sources.json'),'utf8'));
 const directory=path.join(runtimeRoot,'bridge/java/org/instantcad/frc'),files={};
 // Explicit distribution boundary: do not ship team-specific tuning helpers
 // or future development experiments merely because they share this folder.
 for(const name of ['DeviceMath','MotorAdapter','PhoenixMotorAdapter','GameplayPacing','ManagedSession','MatchRuntime','ObjectQuery','PhoenixSimulationEnable','RebuiltMatch','RebuiltSeason','SeasonFrame','SeasonObserver','SeasonPlugin','SimVision','TwinBridge'])files['java/org/instantcad/frc/'+name+'.java']=await readFile(path.join(directory,name+'.java'),'utf8');
 files['instantcad.gradle']=`// Apply from the team's Java robot project. Uses its WPILib/vendor SDK.\nsourceSets.main.java.srcDir(project.file('.cadcove/bridge/java'))\n`;
 files['DEVICE-ADAPTERS.md']=await readFile(path.join(runtimeRoot,'docs/DEVICE-ADAPTERS.md'),'utf8');
 files['SEASON-PLUGINS.md']=await readFile(path.join(runtimeRoot,'docs/SEASON-PLUGINS.md'),'utf8');
 return {schema:1,files};
}
const hash=value=>createHash('sha256').update(value).digest('hex');
async function readSafe(root,file){
 let at=root;
 for(const part of path.relative(root,file).split(path.sep)){
  at=path.join(at,part);
  try{const stat=await lstat(at);if(stat.isSymbolicLink()||(at!==file&&!stat.isDirectory())||(at===file&&!stat.isFile()))throw Error('Bridge path must contain directories and regular files, not symlinks: '+at);}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 try{return await readFile(file,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;return undefined;}
}
export async function exportBridge(workspace,{review=false}={}){
 if(!workspace)throw Error('--workspace is required');
 const root=await realpath(path.resolve(workspace)),sourceDirectory=path.join(root,'.cadcove/bridge'),bundle=await bridgeSources();
 if(bundle.schema!==1||!bundle.files||typeof bundle.files!=='object'||Array.isArray(bundle.files))throw Error('Invalid bridge source bundle');
 const entries=Object.entries(bundle.files).sort(([a],[b])=>a<b?-1:a>b?1:0);
 if(entries.length<1||entries.length>64)throw Error('Invalid bridge source bundle size');
 for(const [relative,content] of entries){
  if(!(['instantcad.gradle','SEASON-PLUGINS.md','DEVICE-ADAPTERS.md'].includes(relative)||/^java\/org\/instantcad\/frc\/[A-Za-z][A-Za-z0-9]*\.java$/.test(relative))||typeof content!=='string'||content.length>512*1024)throw Error('Invalid bridge source entry');
 }
 const bundleSha256=hash(JSON.stringify(entries));
 const destination=review?path.join(root,'.cadcove/bridge-updates',bundleSha256):sourceDirectory;
 const changes=[],comparison=[];
 for(const [relative,content] of entries){
  const file=path.join(destination,relative);
  const old=await readSafe(root,file);
  if(old!==undefined&&old!==content)throw Error('Refusing to overwrite changed bridge source: '+file+(review?' (review copy was edited; preserve or move it before re-exporting)':' — use bridge-export --review to compare the packaged update'));
  if(old===undefined)changes.push({file,content});
  if(review){
   const current=await readSafe(root,path.join(sourceDirectory,relative));
   comparison.push({file:relative,status:current===undefined?'missing':current===content?'identical':'different',currentSha256:current===undefined?null:hash(current),incomingSha256:hash(content)});
  }
 }
 for(const {file,content} of changes){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,content,{flag:'wx'});}
 return {schema:1,ok:true,command:'bridge-export',review,bundleSha256,directory:destination,created:changes.length,
  ...(review?{sourceDirectory,comparison}:{}),
  next:review?'Review differing/missing files in directory against sourceDirectory, merge the needed changes while preserving team customizations, then rebuild the robot JAR and run integration checks. Extra local files are not listed or removed. Review copies are not compiled automatically.':"Apply from: '.cadcove/bridge/instantcad.gradle' in the team's Gradle build, register actual device instances, then build the desktop simulation JAR."};
}
