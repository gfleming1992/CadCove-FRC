// Explicit local content export, independent of the lightweight public toolbox.
// Copies selected source/artifact closures, never a whole development workspace.
import path from 'node:path';
import {readFile,writeFile,mkdir,lstat,readdir,realpath,rm,rename,copyFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {readRobotProject,auditRobotProject} from '../lib/robot-project.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {sourceInputEntries,sourceInputRoot,sourceInputFile} from '../lib/source-freshness.js';
const args=process.argv.slice(2),o={};while(args.length){const k=args.shift(),v=args.shift();if(!['--project','--asset-root','--output','--bridge-source','--component-catalog'].includes(k)||!v||v.startsWith('--')||k in o)throw Error('Usage: bun scripts/export-example-workspace.js --project PROFILE --asset-root SOURCE_ROOT --output NEW_DIRECTORY [--bridge-source BRIDGE_DIRECTORY] [--component-catalog COMPONENTS_JSON]');o[k]=v;}
for(const k of ['--project','--asset-root','--output'])if(!o[k])throw Error('Missing '+k);
const project=await readRobotProject(o['--project']),audit=await auditRobotProject(project);if(!audit.canLoad)throw Error(audit.errors.join('; '));
const assetRoot=await realpath(o['--asset-root']),out=path.resolve(o['--output']);
for(const input of [...Object.values(project.cad),project.runtime.project,project.runtime.nativeLibraries])if(out===input||out.startsWith(input+path.sep))throw Error('Output must be outside copied source trees');
try{await lstat(out);throw Error('Output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(path.dirname(out),{recursive:true});const stage=path.join(path.dirname(out),'.example-'+randomUUID());await mkdir(stage);
const hash=b=>createHash('sha256').update(b).digest('hex'),files=[],seen=new Set();
function relative(value){if(typeof value!=='string'||!value||value.includes('\\')||value.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f:]/.test(p))||path.isAbsolute(value))throw Error('Unsafe example path: '+value);return value;}
async function copy(from,to){relative(to);if(seen.has(to))return;const s=await lstat(from);if(!s.isFile()||s.isSymbolicLink())throw Error('Expected regular example file: '+from);const target=path.join(stage,to);await mkdir(path.dirname(target),{recursive:true});await copyFile(from,target);const bytes=await readFile(target);files.push({file:to,bytes:bytes.length,sha256:hash(bytes)});seen.add(to);}
async function tree(from,to){const s=await lstat(from);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Expected regular source directory');for(const entry of await readdir(from,{withFileTypes:true})){if(entry.name.startsWith('.')||['node_modules','build','target','logs'].includes(entry.name))continue;if(entry.isDirectory())await tree(path.join(from,entry.name),to+'/'+entry.name);else await copy(path.join(from,entry.name),to+'/'+entry.name);}}
try{
 for(const [kind,root] of Object.entries(project.cad))await tree(root,'cad-assets/'+kind);
 await copy(path.join(project.build,'world.json'),'build/cadcove/world.json');
 await copy(path.join(project.build,'scene-bindings.json'),'build/cadcove/scene-bindings.json');
 const scene=JSON.parse(await readFile(path.join(stage,'build/cadcove/scene-bindings.json')));
 const inputs=sourceInputEntries(scene.sourceInputs);
 if(inputs){
  const root=await sourceInputRoot(project,scene.sourceInputs);
  for(const input of inputs){const output=scene.sourceInputs.root==='project'?input.file:'physics-assets/'+input.file;await copy(await sourceInputFile(root,input.file),output);if(hash(await readFile(path.join(stage,output)))!==input.sha256)throw Error('Source input changed during export: '+input.file);}
 }
 const world=JSON.parse(await readFile(path.join(stage,'build/cadcove/world.json'))),refs=new Map();
 function walk(v){if(!v||typeof v!=='object')return;if(v.kind==='mesh_file'){relative(v.file);if(!/^[a-f0-9]{64}$/.test(v.sha256))throw Error('Collision file lacks digest');if(refs.has(v.file)&&refs.get(v.file)!==v.sha256)throw Error('Conflicting collision digest');refs.set(v.file,v.sha256);}Object.values(v).forEach(walk);}walk(world);
 for(const [file,digest] of refs){const resolved=await realpath(path.join(assetRoot,file));if(!resolved.startsWith(assetRoot+path.sep))throw Error('Collision path escapes selected asset root');await copy(resolved,'physics-assets/'+file);if(hash(await readFile(path.join(stage,'physics-assets',file)))!==digest)throw Error('Collision digest mismatch: '+file);}
 // Include only referenced, checksummed cooked shapes when available. They are
 // disposable caches, but avoid repeating convex decomposition on first play.
 for(const digest of new Set(refs.values())){
  const name=digest+'-rapier036-vhacd128-c001-h64-v1.cpc',cached=path.join(assetRoot,'build/physics-cache',name);
  try{const bytes=await readFile(cached);if(bytes.length>=36&&bytes.length<=64*1024*1024&&bytes.subarray(0,4).toString()==='CPC1'&&createHash('sha256').update(bytes.subarray(36)).digest().equals(bytes.subarray(4,36)))await copy(cached,'physics-assets/build/physics-cache/'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 for(const name of ['src','vendordeps','gradle','docs']){const from=path.join(project.runtime.project,name);try{await lstat(from);}catch(e){if(e.code==='ENOENT')continue;throw e;}await tree(from,'robot-code/'+name);}
 for(const name of ['build.gradle','settings.gradle','gradle.properties','gradlew','gradlew.bat','.wpilib/wpilib_preferences.json','WPILib-License.md','AdvantageKit-License.md','LICENSE','LICENSE.md']){const from=path.join(project.runtime.project,name);try{await lstat(from);}catch(e){if(e.code==='ENOENT')continue;throw e;}await copy(from,'robot-code/'+name);}
 // Migrate the old local demo's explicit external bridge include. Other build
 // systems are left as authored; no guessed Gradle rewrite or external download.
 const gradleFile=path.join(stage,'robot-code/build.gradle');
 let gradle=await readFile(gradleFile,'utf8');
 const legacy='apply from: "../../bridge/instantcad.gradle"';
 if(gradle.includes(legacy)){
  if(!o['--bridge-source'])throw Error('This source references an external bridge; supply --bridge-source explicitly');
  await tree(path.join(await realpath(o['--bridge-source']),'java'),'robot-code/.cadcove/bridge/java');
  await writeFile(path.join(stage,'robot-code/.cadcove/bridge/instantcad.gradle'),"sourceSets.main.java.srcDir(project.file('.cadcove/bridge/java'))\n");
  gradle=gradle.replace(legacy,"apply from: '.cadcove/bridge/instantcad.gradle'");
 }else{
  const existing=path.join(project.runtime.project,'.cadcove/bridge');
  try{await lstat(existing);await tree(existing,'robot-code/.cadcove/bridge');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 await writeFile(gradleFile,gradle+"\n// Keep rebuilt output aligned with this local example's runtime manifest.\ntasks.named('jar') { archiveFileName = 'robot.jar' }\n");
 await copy(project.runtime.jar,'robot-code/build/libs/robot.jar');await tree(project.runtime.nativeLibraries,'robot-code/build/jni/release');
 // Open an existing editable robot directly. Its entire relative import graph
 // was copied above; initializing a separate empty CAD folder hides that model.
 const robotEntry=await lstat(path.join(stage,'cad-assets/robot/model.js')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 const cadDirectory=robotEntry?.isFile()?'cad-assets/robot':'cad';
 await initializeToolbox({workspace:stage,id:'team-example',name:project.profile.name,cadDirectory,buildDirectory:'build/cadcove'});
 const profile=structuredClone(project.profile);delete profile.compiler;profile.id='team-example';profile.cad={robot:'cad-assets/robot',field:'cad-assets/field'};profile.build='build/cadcove';profile.runtime={...profile.runtime,assetRoot:'physics-assets',project:'robot-code',jar:'robot-code/build/libs/robot.jar',nativeLibraries:'robot-code/build/jni/release'};delete profile.runtime.jdk;
 await writeFile(path.join(stage,'robot.sim.json'),JSON.stringify(profile,null,2)+'\n');
 let componentCatalog=null;
 if(o['--component-catalog']){
  const catalog=JSON.parse(await readFile(o['--component-catalog'],'utf8'));
  if(catalog.schema!==1||!Array.isArray(catalog.components)||catalog.components.some(c=>!c||typeof c.family!=='string'||typeof c.model!=='string'))throw Error('Component catalog requires schema 1 and components with family and model');
  componentCatalog='.cadcove/example/components.json';await copy(o['--component-catalog'],componentCatalog);
 }
 await writeFile(path.join(stage,'.cadcove/frc.json'),JSON.stringify({schema:1,example:project.profile.id,componentCatalog,seasonKnowledge:null,componentPreference:['CTRE Phoenix 6','WCP','Limelight']},null,2)+'\n');
 const check=await auditRobotProject(await readRobotProject(path.join(stage,'robot.sim.json')));if(!check.canLoad)throw Error(check.errors.join('; '));
 for(const f of files){const bytes=await readFile(path.join(stage,f.file));f.bytes=bytes.length;f.sha256=hash(bytes);}
 await writeFile(path.join(stage,'example-provenance.json'),JSON.stringify({schema:1,platform:process.platform,architecture:process.arch,sourceProject:project.profile.id,worldHash:audit.worldHash,publicRedistributionReady:false,hardwareQualified:false,files},null,2)+'\n');
 await writeFile(path.join(stage,'README.md'),'# Local robot and field example\n\nOpen robot.sim.json with CadCove: Open Live Simulation. Run cadcove doctor first.\nThe selected JAR/native libraries are a platform-specific snapshot; rebuild after code changes.\nOriginal robot source is in robot-code/, original part STEP files in cad-assets/robot/components/.\n'+(robotEntry?.isFile()?'Open robot CAD to edit cad-assets/robot/model.js. Converted part builders and retained STEP components are assembled through that entry. See cad-assets/robot/PARAMETRIC-README.md when supplied.\n':'The CAD authoring folder cad/ is empty: assemble/edit referenced parts there and regenerate bindings explicitly.\n')+'No generic mechanism compiler or automatic STEP-to-Java authoring is implied.\nRead .cadcove/skills/frc-workflow/SKILL.md. Imported season knowledge stays private.\nPublic redistribution and hardware calibration are not established.\n');
 await rename(stage,out);console.log(JSON.stringify({ok:true,output:out,files:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),worldHash:audit.worldHash,qualification:'artifact-audit-only',publicRedistributionReady:false}));
}finally{await rm(stage,{recursive:true,force:true});}
