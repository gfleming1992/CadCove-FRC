import fs from 'node:fs/promises';
import path from 'node:path';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {resolveNativePython} from '../vendor/cad-core/src/native/client.js';
import {projectLayout,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadProjectSettings} from './cad-project.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';
const native=name=>path.join(runtimeRoot,...(bundledRuntime?[name==='worker.py'?'cad-worker.py':name]:['vendor','cad-core','src','native',name]));

export async function drawingCommand(options={}){
 const action=options.action??'capabilities';
 if(action==='capabilities')return {ok:true,backend:'FreeCAD TechDraw',optional:true,formats:['pdf','svg','FCStd'],units:'mm',page:'A4 landscape',views:['top','front','right','isometric'],dimensions:['horizontal','vertical','distance','diameter'],source:'one exact native CAD solid',reviewRequired:true,limitations:['Explicit dimension references and page positions required','No automatic tolerances, materials, GD&T, section views or CAM toolpaths','Offscreen Qt is required by the page exporter; FreeCAD is installed separately']};
 if(action!=='export')throw Error('Drawing action must be capabilities or export');
 if(!options.input||!options.output)throw Error('Drawing export requires --input REQUEST.json --output NEW_DIRECTORY');
 const freecad=options.freecad??process.env.CADCOVE_FREECAD;
 if(!freecad||!path.isAbsolute(freecad))throw Error('Configure an absolute FreeCADCmd path using --freecad or CADCOVE_FREECAD');
 await fs.access(freecad,fs.constants.X_OK);
 const output=path.resolve(options.output);
 try{await fs.stat(output);throw Error('Drawing output already exists: '+output);}catch(e){if(e.code!=='ENOENT')throw e;}
 const request=JSON.parse(await fs.readFile(path.resolve(options.input),'utf8'));
 const workspace=path.resolve(options.workspace??process.cwd()),settings=await cadProjectSettings(workspace);
 if(options.entry){relativePath(options.entry);settings.entryPoint=options.entry;}
 const session=new NativeCadSession({layout:await projectLayout(workspace,settings),python:resolveNativePython({explicit:options.python,environment:process.env.CADCOVE_PYTHON,project:settings.pythonPath,root:workspace}),worker:native('worker.py'),onLog:text=>process.stderr.write(text)});
 let exported;
 try{
  await session.build();
  exported=await session.inspect(`import json\nfrom drawing_geometry import export_drawing\nresult=export_drawing(parts,json.loads(${JSON.stringify(JSON.stringify(request))}),${JSON.stringify(output)})`);
 }finally{session.dispose();}
 await fs.writeFile(path.join(output,'source.json'),JSON.stringify({revision:exported.revision,shapeHash:exported.result.shapeHash},null,2),{flag:'wx'});
 const log=await fs.open(path.join(output,'backend.log'),'wx');
 let timer;
 try{
  const proc=Bun.spawn([freecad,'-u',path.join(output,'user.cfg'),'-s',path.join(output,'system.cfg'),native('drawing_freecad.py')],{env:{...process.env,QT_QPA_PLATFORM:'offscreen',CADCOVE_DRAWING_JOB:output},stdin:'ignore',stdout:log.fd,stderr:log.fd});
  let timeout=false;timer=setTimeout(()=>{timeout=true;proc.kill();},120000);
  const code=await proc.exited;
  if(timeout)throw Error('Drawing export timed out; inspect '+path.join(output,'backend.log'));
  let result;try{result=JSON.parse(await fs.readFile(path.join(output,'result.json'),'utf8'));}catch{throw Error('FreeCAD produced no drawing result; inspect '+path.join(output,'backend.log'));}
  if(code||!result.ok)throw Error(result.error??'FreeCAD drawing export failed');
  return {...result,sourceRevision:exported.revision,output,paths:Object.fromEntries(Object.keys(result.files).map(name=>[name,path.join(output,name)]))};
 }finally{clearTimeout(timer);await log.close();}
}
