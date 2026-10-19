// Offline recording experiment. Does not modify or publish the extension.
import {downloadAndUnzipVSCode} from '@vscode/test-electron';
import {mkdir,writeFile,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=process.cwd(),out=path.join(root,'artifacts/quickstart');
await mkdir(out,{recursive:true});
const profile=path.join(root,'build/cloud-recording'),workspace=path.join(profile,'Amarillo-CAD');
for(const d of ['user/User','extensions','driver','Amarillo-CAD/.cadcove','Amarillo-CAD/.vscode'])await mkdir(path.join(profile,d),{recursive:true});
await cp(path.join(root,'examples/team3310-rebuilt/source/cad-assets/robot'),path.join(workspace,'cad-assets/robot'),{recursive:true});
await writeFile(path.join(workspace,'.cadcove/project.json'),JSON.stringify({schema:1,sourceDirectory:'cad-assets/robot',buildDirectory:'build/cadcove',entryPoint:'models.py'}));
await writeFile(path.join(profile,'user/User/settings.json'),JSON.stringify({
 'instantcad.pythonPath':process.env.CADCOVE_PYTHON,'workbench.colorTheme':'Default Dark Modern','window.zoomLevel':1,
 'window.newWindowDimensions':'maximized','workbench.startupEditor':'none','workbench.editor.enablePreview':false,
 'editor.fontSize':20,'editor.minimap.enabled':false,'breadcrumbs.enabled':false,'telemetry.telemetryLevel':'off',
 'extensions.autoUpdate':false,'extensions.autoCheckUpdates':false,'update.mode':'none',
 'files.exclude':{'**/__pycache__':true,'build':true},'workbench.activityBar.location':'default'
}));
await writeFile(path.join(profile,'driver/package.json'),JSON.stringify({name:'cadcove-recording-driver',publisher:'cadcove',version:'0.0.1',engines:{vscode:'^1.100.0'},main:'index.cjs',activationEvents:[]}));
await writeFile(path.join(profile,'driver/index.cjs'),'exports.activate=()=>{};');
async function files(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);result.push(...(e.isDirectory()?await files(p):[p]));}return result;}
const vsix=(await files(path.join(root,'artifacts/qualified'))).find(p=>p.endsWith('.vsix'));if(!vsix)throw Error('Qualified VSIX missing');
const executable=await downloadAndUnzipVSCode({version:'1.105.1',cachePath:path.join(root,'build/editor-cache')});
for(const args of [['chown','root:root'],['chmod','4755']]){const p=Bun.spawn(['sudo','-n',...args,path.join(path.dirname(executable),'chrome-sandbox')],{stdout:'inherit',stderr:'inherit'});if(await p.exited)throw Error('Sandbox setup failed');}
const wm=spawn('openbox',[],{stdio:'ignore'});
const env={...process.env,CADCOVE_RECORD_OUT:out,CADCOVE_RECORD_VSIX:vsix};
for(const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','GH_TOKEN','GITHUB_TOKEN'])delete env[key];
const args=['--user-data-dir',path.join(profile,'user'),'--extensions-dir',path.join(profile,'extensions'),
 '--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader',
 '--new-window','--start-maximized','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates',
 `--extensionDevelopmentPath=${path.join(profile,'driver')}`,`--extensionTestsPath=${path.join(root,'scripts/video/record-driver.cjs')}`,workspace];
const editor=spawn(executable,args,{env,stdio:'inherit'});
const timeout=setTimeout(()=>editor.kill('SIGTERM'),12*60*1000);
const code=await new Promise((resolve,reject)=>{editor.on('error',reject);editor.on('exit',resolve);});clearTimeout(timeout);wm.kill();
process.exitCode=code??1;
