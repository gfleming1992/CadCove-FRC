// End-to-end source-distribution build. Runs without team assets, robot SDKs,
// recordings, sibling repositories, or the original checkout's node_modules.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const args=process.argv.slice(2);if(![2,3].includes(args.length)||args[0]!=='--output'||args.length===3&&args[2]!=='--editor')throw Error('Usage: bun scripts/verify-toolbox-source.js --output NEW_DIRECTORY [--editor]');
const testEditor=args[2]==='--editor';
if(testEditor&&!/^\d+\.\d+\.\d+$/.test(process.env.CADCOVE_TEST_EDITOR_VERSION??''))throw Error('--editor requires an exact CADCOVE_TEST_EDITOR_VERSION');
const root=path.resolve(import.meta.dir,'..'),output=path.resolve(args[1]);
const steps=[];
async function run(name,command,cwd=output){
 const start=performance.now();console.log('Source verification: '+name);
 const child=Bun.spawn(command,{cwd,env:{...process.env,CARGO_BUILD_JOBS:process.env.CARGO_BUILD_JOBS??'4'},stdout:'inherit',stderr:'inherit'});
 const exitCode=await child.exited;steps.push({name,exitCode,ms:Math.round(performance.now()-start)});
 if(exitCode)throw Error('Source verification failed: '+name);
}
let ok=false,error,artifacts,editorQualification;
try{
 await run('export',[process.execPath,'scripts/export-toolbox-source.js','--output',output],root);
 await run('frozen dependency installation',[process.execPath,'install','--frozen-lockfile']);
 await run('toolbox contracts',[process.execPath,'run','test:toolbox']);
 await run('native contracts',['cargo','test','--locked','--release','-p','instantcad-sim','--features','composite-compact','--target-dir','target/distribution']);
 await run('baseline native release',[process.execPath,'scripts/build-native-runtime.js']);
 const executable='instantcad-sim'+(process.platform==='win32'?'.exe':'');
 await run('standalone runtime packaging',[process.execPath,'scripts/package-runtime.js','--native-binary','target/distribution/release/'+executable,'--output','artifacts/runtime-source-check','--version','0.1.0-source-check','--base-url','https://releases.invalid/source-check/'+process.platform+'-'+process.arch]);
 await run('relocated offline runtime',[process.execPath,'tests/packaged-runtime.js','artifacts/runtime-source-check']);
 await run('extension build',[process.execPath,'scripts/build-toolbox-extension.js','--runtime','artifacts/runtime-source-check']);
 await run('verified development VSIX',[process.execPath,'scripts/package-toolbox-extension.js','--extension','build/toolbox-extension-'+process.platform+'-'+process.arch,'--output','artifacts/cadcove-source-check.vsix','--development']);
 const runtime=JSON.parse(await readFile(path.join(output,'artifacts/runtime-source-check/manifest.json'),'utf8'));
 const cliBuild=JSON.parse(await readFile(path.join(output,'artifacts/runtime-source-check/cli-build.json'),'utf8'));
 const vsix=await readFile(path.join(output,'artifacts/cadcove-source-check.vsix'));
 artifacts={runtime,cliBuild,vsix:{name:'cadcove-source-check.vsix',bytes:vsix.length,sha256:createHash('sha256').update(vsix).digest('hex')}};
 if(testEditor){
  try{await run('installed editor CAD and runtime',[process.execPath,'scripts/test-toolbox-extension.js','artifacts/cadcove-source-check.vsix']);}
  finally{editorQualification=await readFile(path.join(output,'artifacts/toolbox-extension-test-report.json'),'utf8').then(JSON.parse,()=>null);}
 }
 ok=true;
}catch(e){error=String(e.stack||e);process.exitCode=1;}
const provenance=await readFile(path.join(output,'source-provenance.json'),'utf8').then(JSON.parse,()=>null);
const report={schema:1,ok,target:process.platform+'-'+process.arch,sourceRevision:provenance?.sourceRevision,output,steps,artifacts,error,published:false,editorInstallationTested:editorQualification?.ok===true,editorQualification,vendorSDKTested:editorQualification?.qualification?.vendorSDKTested===true};
await mkdir(path.join(root,'artifacts'),{recursive:true});await writeFile(path.join(root,'artifacts/source-verification-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
