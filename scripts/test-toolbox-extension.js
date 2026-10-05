import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {realpath,access} from 'node:fs/promises';
import {downloadAndUnzipVSCode} from '@vscode/test-electron';
import {readZip} from '@vscode/vsce/out/zip.js';
const vsix=process.argv[2];if(!vsix)throw Error('Pass the VSIX to test');
const root=path.resolve(import.meta.dir,'..');
const profile=await mkdtemp(path.join(os.tmpdir(),'cadcove-vsix-test-'));
const folders={user:path.join(profile,'user'),extensions:path.join(profile,'extensions'),workspace:path.join(profile,'team'),driver:path.join(profile,'test-driver')};
for(const folder of Object.values(folders))await mkdir(folder,{recursive:true});
// Optional actual WPILib installer inputs. Keep all extension/profile changes
// inside this test directory; never install into a student's working editor.
const companions=[];
if(process.env.CADCOVE_TEST_WPILIB_CONFIG){
 const config=JSON.parse(await readFile(process.env.CADCOVE_TEST_WPILIB_CONFIG,'utf8'));
 const vsixRoot=process.env.CADCOVE_TEST_WPILIB_VSIX_ROOT;
 if(!vsixRoot||typeof config.VsCodeVersion!=='string'||!config.wpilibExtension||!Array.isArray(config.thirdPartyExtensions))throw Error('WPILib qualification requires installer configuration and VSIX root');
 for(const item of [config.wpilibExtension,...config.thirdPartyExtensions]){
  if(typeof item.vsix!=='string'||path.basename(item.vsix)!==item.vsix||!item.name||!item.version)throw Error('Invalid WPILib companion descriptor');
  companions.push({...item,file:path.resolve(vsixRoot,item.vsix)});
 }
 await writeFile(path.join(folders.workspace,'companion-expectations.json'),JSON.stringify({editorVersion:config.VsCodeVersion,extensions:companions.map(({name,version})=>({name,version}))}));
 // Explicitly disable update churn for the pinned qualification, not user settings.
 await mkdir(path.join(folders.user,'User'),{recursive:true});
 await writeFile(path.join(folders.user,'User/settings.json'),JSON.stringify({'update.mode':'none','extensions.autoUpdate':false,'extensions.autoCheckUpdates':false}));
}
// Optional full runtime fixture. Copy generated world data to a fresh build
// directory so this editor test never controls an existing demo session.
if(process.env.CADCOVE_TEST_SIMULATION_PROJECT){
 const source=path.resolve(process.env.CADCOVE_TEST_SIMULATION_PROJECT),base=path.dirname(source);
 const manifest=JSON.parse(await readFile(source,'utf8')),oldBuild=path.resolve(base,manifest.build);
 manifest.id='installed-extension-test';manifest.name='Installed extension test';
 manifest.practiceInput??={driverPort:0}; // Preserve the fixture's actual robot mapping.
 for(const key of ['robot','field'])manifest.cad[key]=path.resolve(base,manifest.cad[key]);
 for(const key of ['project','jar','nativeLibraries','jdk','assetRoot'])if(manifest.runtime[key])manifest.runtime[key]=path.resolve(base,manifest.runtime[key]);
 manifest.runtime.assetRoot??=base;
 manifest.build=path.join(folders.workspace,'build/simulation-test');await mkdir(manifest.build,{recursive:true});
 for(const name of ['world.json','scene-bindings.json'])await copyFile(path.join(oldBuild,name),path.join(manifest.build,name));
 await writeFile(path.join(folders.workspace,'simulation-fixture.json'),JSON.stringify(manifest,null,2));
}
await writeFile(path.join(folders.driver,'package.json'),JSON.stringify({name:'cadcove-test-driver',publisher:'cadcove-test',version:'0.0.1',engines:{vscode:'^1.100.0'},main:'./index.cjs',activationEvents:[]}));
await writeFile(path.join(folders.driver,'index.cjs'),'exports.activate=()=>{};');
const requestedVersion=process.env.CADCOVE_TEST_EDITOR_VERSION;
if(requestedVersion&&!/^\d+\.\d+\.\d+$/.test(requestedVersion))throw Error('Pin an exact CADCOVE_TEST_EDITOR_VERSION, not stable/latest');
if(requestedVersion&&process.env.VSCODE_EXECUTABLE)throw Error('Select a downloaded editor version or a local VSCODE_EXECUTABLE, not both');
let executable=requestedVersion
 ?await downloadAndUnzipVSCode({version:requestedVersion,cachePath:path.join(root,'build/editor-test-cache'),timeout:60000})
 :(process.env.VSCODE_EXECUTABLE??(process.platform==='darwin'?'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code':'code'));
executable=await realpath(path.isAbsolute(executable)?executable:Bun.which(executable)??executable);
// Use the actual Electron executable on every platform. In particular, passing
// code.cmd to spawn without a shell fails on Windows. Running the shipped cli.js
// as Electron's Node process preserves argument boundaries without a shell.
if(process.platform==='darwin'&&executable.endsWith('/Contents/Resources/app/bin/code')){
 const binaries=path.resolve(path.dirname(executable),'../../../MacOS');
 executable=path.join(binaries,'Electron');
 try{await access(executable);}catch(error){if(error.code!=='ENOENT')throw error;executable=path.join(binaries,'Code');}
}
else if(process.platform==='win32'&&path.basename(executable).toLowerCase()==='code.cmd')executable=path.resolve(path.dirname(executable),'../Code.exe');
else if(process.platform==='linux'&&path.basename(path.dirname(executable))==='bin')executable=path.resolve(path.dirname(executable),'../code');
const cli=process.platform==='darwin'?path.resolve(path.dirname(executable),'../Resources/app/out/cli.js'):path.join(path.dirname(executable),'resources/app/out/cli.js');
await access(executable);await access(cli);
const env={...process.env};
for(const key of ['ELECTRON_RUN_AS_NODE','VSCODE_IPC_HOOK_CLI','NODE_OPTIONS','NODE_REPL_EXTERNAL_MODULE'])delete env[key];
const archive=await readZip(path.resolve(vsix),name=>name==='extension/package.json');
const manifest=JSON.parse(archive.get('extension/package.json'));
env.CADCOVE_TEST_EXTENSION_ID=manifest.publisher+'.'+manifest.name;
const args=['--user-data-dir',folders.user,'--extensions-dir',folders.extensions];
async function install(file){return await new Promise((resolve,reject)=>{const p=spawn(executable,[cli,...args,'--install-extension',path.resolve(file),'--force'],{env:{...env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',timeout:90000});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('VSIX installation failed: '+code)));});}
for(const companion of companions)await install(companion.file);
await install(vsix);
const reportFile=path.join(folders.workspace,'extension-test-report.json');
const softwareGPU=process.env.CADCOVE_TEST_SOFTWARE_GPU==='1';
const graphics=softwareGPU?['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader']:[];
const child=spawn(executable,[...args,...graphics,'--new-window',`--extensionDevelopmentPath=${folders.driver}`,`--extensionTestsPath=${path.join(root,'tests/toolbox-extension-runner.cjs')}`,'--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates',folders.workspace],{env,stdio:'inherit',detached:process.platform!=='win32'});
let launchError,exited=false;
const completion=new Promise(resolve=>{child.on('error',error=>{launchError=error;exited=true;resolve();});child.on('exit',()=>{exited=true;resolve();});});
console.log(JSON.stringify({profile,pid:child.pid,reportFile}));
let result;
try{
 const until=Date.now()+180000;
 while(Date.now()<until){
  if(launchError)throw launchError;
  try{result=JSON.parse(await readFile(reportFile,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  if(result)break;
  if(exited)throw Error('Editor exited before writing its test report: '+child.exitCode);
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!result)throw Error('Installed extension test timed out; inspect '+profile);
 if(result.ok&&requestedVersion&&result.editorVersion!==requestedVersion)throw Error('Editor version differs from the requested qualification pin');
}catch(error){result={ok:false,error:String(error.stack??error),runnerResult:result,profile};}
finally{
 // The test host normally exits after run(). Bound cleanup to this isolated
 // process tree; never search for or kill the user's editor by name.
 async function waitForExit(ms){let timer;await Promise.race([completion,new Promise(resolve=>timer=setTimeout(resolve,ms))]);clearTimeout(timer);}
 await waitForExit(5000);
 if(!exited&&child.pid){
  if(process.platform==='win32')await new Promise(resolve=>{const kill=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',timeout:5000});kill.on('error',resolve);kill.on('exit',resolve);});
  else{try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
  await waitForExit(3000);
  if(!exited&&process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await waitForExit(2000);}
  if(!exited)result={...result,ok:false,cleanupError:'The isolated test editor did not exit: '+child.pid};
 }
}
result.qualification={target:process.platform+'-'+process.arch,requestedVersion:requestedVersion??null,softwareGPURequested:softwareGPU,vsixSha256:createHash('sha256').update(await readFile(vsix)).digest('hex'),vendorSDKTested:!!result.simulation};
await mkdir(path.join(root,'artifacts'),{recursive:true});await writeFile(path.join(root,'artifacts/toolbox-extension-test-report.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
