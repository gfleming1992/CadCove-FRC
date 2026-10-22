// Optional, headless SheetMetal integration. Never installs dependencies or changes CAD.
import fs from 'node:fs/promises';
import path from 'node:path';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {resolveNativePython} from '../vendor/cad-core/src/native/client.js';
import {projectLayout,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadProjectSettings} from './cad-project.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';
import {showSvg} from './flat-command.js';
const native=name=>path.join(runtimeRoot,...(bundledRuntime?[name==='worker.py'?'cad-worker.py':name]:['vendor','cad-core','src','native',name]));

export async function sheetmetalCommand(options={}){
 const action=options.action??'capabilities';
 if(action==='capabilities')return {ok:true,experimental:true,commands:['unfold'],backend:'external FreeCADCmd + SheetMetal NewUnfolder',requiresEditor:false,requiresGUI:false,units:'mm',scale:1,formats:['step','dxf','svg'],scope:'Single solid with planar walls and cylindrical bends; explicit root face, thickness and ANSI/DIN K-factor',limitations:['Unfolding only; no bend/flange authoring command yet','No machine-specific DFM, forming simulation or toolpaths']};
 if(action!=='unfold'||!options.input||!options.output)throw Error('Use cad-sheetmetal --action unfold --input REQUEST.json --output NEW_DIRECTORY');
 const freecad=options.freecad??process.env.CADCOVE_FREECAD,addon=options.sheetmetal??process.env.CADCOVE_SHEETMETAL;
 if(!freecad||!path.isAbsolute(freecad))throw Error('Configure an absolute CADCOVE_FREECAD executable path (FreeCADCmd)');
 if(!addon||!path.isAbsolute(addon))throw Error('Configure an absolute CADCOVE_SHEETMETAL add-on directory');
 await fs.access(freecad,fs.constants.X_OK);await fs.access(path.join(addon,'SheetMetalNewUnfolder.py'));
 const workspace=path.resolve(options.workspace??process.cwd()),output=path.resolve(options.output);
 try{await fs.stat(output);throw Error('Sheet metal output already exists: '+output);}catch(e){if(e.code!=='ENOENT')throw e;}
 const request=JSON.parse(await fs.readFile(path.resolve(options.input),'utf8'));
 const settings=await cadProjectSettings(workspace);
 if(options.entry){relativePath(options.entry);settings.entryPoint=options.entry;}
 const python=resolveNativePython({explicit:options.python,environment:process.env.CADCOVE_PYTHON,project:settings.pythonPath,root:workspace});
 const session=new NativeCadSession({layout:await projectLayout(workspace,settings),python,worker:native('worker.py'),onLog:text=>process.stderr.write(text)});
 let exported;
 try{
  await session.build();
  exported=await session.inspect(`import json\nfrom sheetmetal_geometry import export_job\nresult=export_job(parts,json.loads(${JSON.stringify(JSON.stringify(request))}),${JSON.stringify(output)})`);
 }finally{session.dispose();}
 await fs.writeFile(path.join(output,'source.json'),JSON.stringify({sourceRevision:exported.revision,shapeHash:exported.result.shapeHash},null,2),{flag:'wx'});
 const log=await fs.open(path.join(output,'backend.log'),'wx');
 try{
  const p=Bun.spawn([freecad,'-u',path.join(output,'user.cfg'),'-s',path.join(output,'system.cfg'),native('sheetmetal_freecad.py')],{env:{...process.env,CADCOVE_SHEETMETAL:addon,CADCOVE_SHEETMETAL_JOB:output},stdin:'ignore',stdout:log.fd,stderr:log.fd});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;p.kill();},120000);
  try{
   const code=await p.exited;
   if(timedOut)throw Error('SheetMetal timed out after 120 seconds; inspect '+path.join(output,'backend.log'));
   let backend;try{backend=JSON.parse(await fs.readFile(path.join(output,'backend-result.json'),'utf8'));}catch{throw Error('SheetMetal produced no structured result; inspect '+path.join(output,'backend.log'));}
   if(code||!backend.ok)throw Error(backend.error??'SheetMetal failed; inspect backend.log');
  }finally{clearTimeout(timer);}
 }finally{await log.close();}
 const p=Bun.spawn([python,native('sheetmetal_geometry.py'),'--finish',output,...(options.explain?['--explain']:[])],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;p.kill();},60000);
 try{
  const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  if(timedOut)throw Error('Sheet metal DXF validation timed out');
  let result;try{result=JSON.parse(stdout);}catch{throw Error('Sheet metal DXF export failed: '+stderr.slice(-2000));}
  if(code||!result.ok)throw Error(result.error??'Sheet metal DXF export failed');
  result={...result,sourceRevision:exported.revision,output,svg:path.join(output,'preview.svg'),dxf:path.join(output,'cut.dxf'),bendDxf:path.join(output,'unfold.dxf'),step:path.join(output,'flat.step'),...(options.explain?{animationSvg:path.join(output,'folds.svg')}:{})};
  if(options.show){try{result.display=await showSvg(workspace,result.svg);if(result.animationSvg)result.animationDisplay=await showSvg(workspace,result.animationSvg);}catch(error){result.display={ok:false,error:error.message};}}
  return result;
 }finally{clearTimeout(timer);}
}
