// Optional, headless SheetMetal integration. Never installs dependencies or changes CAD.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {connectEditor} from './mcp-proxy.js';
import {cadCommand} from './cad-command.js';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {resolveNativePython} from '../vendor/cad-core/src/native/client.js';
import {projectLayout,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadProjectSettings} from './cad-project.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';
import {showSvg} from './flat-command.js';
const native=name=>path.join(runtimeRoot,...(bundledRuntime?[name==='worker.py'?'cad-worker.py':name]:['vendor','cad-core','src','native',name]));

export async function sheetmetalCommand(options={}){
 const action=options.action??'capabilities';
 if(action==='capabilities')return {ok:true,experimental:true,commands:['unfold','preview'],backend:'external FreeCADCmd + SheetMetal NewUnfolder',requiresEditor:false,requiresGUI:false,units:'mm',scale:1,formats:['step','dxf','svg','3d-fold-preview'],scope:'Single solid with planar walls and cylindrical bends; explicit root face, thickness and ANSI/DIN K-factor',limitations:['Unfolding and geometric fold preview; no bend/flange authoring command yet','No machine-specific DFM, forming simulation or toolpaths']};
 if(!['unfold','preview'].includes(action)||!options.input||!options.output)throw Error('Use cad-sheetmetal --action unfold --input REQUEST.json or --action preview --input UNFOLD_DIRECTORY; both require --output NEW_DIRECTORY');
 const freecad=options.freecad??process.env.CADCOVE_FREECAD,addon=options.sheetmetal??process.env.CADCOVE_SHEETMETAL;
 if(!freecad||!path.isAbsolute(freecad))throw Error('Configure an absolute CADCOVE_FREECAD executable path (FreeCADCmd)');
 if(!addon||!path.isAbsolute(addon))throw Error('Configure an absolute CADCOVE_SHEETMETAL add-on directory');
 await fs.access(freecad,fs.constants.X_OK);await fs.access(path.join(addon,'SheetMetalNewUnfolder.py'));
 const workspace=path.resolve(options.workspace??process.cwd()),output=path.resolve(options.output);
 try{await fs.stat(output);throw Error('Sheet metal output already exists: '+output);}catch(e){if(e.code!=='ENOENT')throw e;}
 const input=path.resolve(options.input);
 const seconds=Number(options.seconds??4);if(!Number.isFinite(seconds)||seconds<=0||seconds>60)throw Error('Fold seconds per bend must be in (0,60]');
 const settings=await cadProjectSettings(workspace);
 if(options.entry){relativePath(options.entry);settings.entryPoint=options.entry;}
 const python=resolveNativePython({explicit:options.python,environment:process.env.CADCOVE_PYTHON,project:settings.pythonPath,root:workspace});
 let previewEntry;
 if(action==='preview'){
  const sourceRoot=await fs.realpath(path.join(workspace,settings.sourceDirectory));
  const realParent=await fs.realpath(path.dirname(output));
  const rel=path.relative(sourceRoot,path.join(realParent,path.basename(output)));
  if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Preview output must be a new directory inside the configured CAD source directory');
  previewEntry=path.join(rel,'models.py').split(path.sep).join('/');
 }
 let exported;
 if(action==='preview'){
  const job=JSON.parse(await fs.readFile(path.join(input,'input.json'),'utf8')),bytes=await fs.readFile(path.join(input,'input.brep'));
  if(createHash('sha256').update(bytes).digest('hex')!==job.geometrySha256)throw Error('Original sheet metal BREP hash mismatch');
  const source=JSON.parse(await fs.readFile(path.join(input,'source.json'),'utf8'));
  await fs.mkdir(output,{recursive:false});await fs.writeFile(path.join(output,'input.json'),JSON.stringify(job));await fs.writeFile(path.join(output,'input.brep'),bytes);
  exported={revision:source.sourceRevision,result:job};
 }else{
 const request=JSON.parse(await fs.readFile(input,'utf8'));
 const session=new NativeCadSession({layout:await projectLayout(workspace,settings),python,worker:native('worker.py'),onLog:text=>process.stderr.write(text)});
 try{
  await session.build();
  exported=await session.inspect(`import json\nfrom sheetmetal_geometry import export_job\nresult=export_job(parts,json.loads(${JSON.stringify(JSON.stringify(request))}),${JSON.stringify(output)})`);
 }finally{session.dispose();}
 }
 await fs.writeFile(path.join(output,'source.json'),JSON.stringify({sourceRevision:exported.revision,shapeHash:exported.result.shapeHash},null,2),{flag:'wx'});
 const log=await fs.open(path.join(output,'backend.log'),'wx');
 try{
  const p=Bun.spawn([freecad,'-u',path.join(output,'user.cfg'),'-s',path.join(output,'system.cfg'),native('sheetmetal_freecad.py')],{env:{...process.env,CADCOVE_SHEETMETAL:addon,CADCOVE_SHEETMETAL_JOB:output,CADCOVE_SHEETMETAL_FOLD:action==='preview'?'1':'0'},stdin:'ignore',stdout:log.fd,stderr:log.fd});
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
  if(action==='preview'){
   result.foldPreview=await createFoldPreview({workspace,output,entry:previewEntry,seconds,python,show:options.show,backend:result.backend});
  }else if(options.show){try{result.display=await showSvg(workspace,result.svg);if(result.animationSvg)result.animationDisplay=await showSvg(workspace,result.animationSvg);}catch(error){result.display={ok:false,error:error.message};}}
  return result;
 }finally{clearTimeout(timer);}
}

async function createFoldPreview({workspace,output,entry,seconds,python,show,backend}){
 const file=path.join(output,'fold-definition.json'),bytes=await fs.readFile(file);
 if(createHash('sha256').update(bytes).digest('hex')!==backend.fold?.sha256)throw Error('Fold definition hash mismatch');
 const definition=JSON.parse(bytes),zones=definition.zones;
 if(definition.bends.length*seconds+2>300)throw Error('Fold preview exceeds 300 seconds');
 for(const z of zones){
  if(!/^zone-\d+\.step$/.test(z.file)||createHash('sha256').update(await fs.readFile(path.join(output,z.file))).digest('hex')!==z.sha256)throw Error('Fold geometry hash mismatch');
 }
 const source=`# Generated display of checked flat regions; original CAD stays unchanged.
import cadquery as cq
from pathlib import Path
def build(ctx):
 prefix=Path(__file__).parent.relative_to(ctx.root).as_posix()
 specs=${JSON.stringify(zones.map(z=>[z.id,z.file,z.sha256]))}
 result=[]
 for name,file,digest in specs:
  asset=prefix+'/'+file
  shape=ctx.component(name,lambda:ctx.import_step(asset,digest),dependencies=[asset,prefix+'/models.py'])
  result.append(dict(id=name,name=name,shape=shape,color='#73b9df'))
 return result
`;
 await fs.writeFile(path.join(output,'models.py'),source,{flag:'wx'});
 const built=await cadCommand('cad-build',{workspace,entry,python});
 const solution={schema:1,sourceRevision:built.revision,definition,tracks:definition.bends.map((b,i)=>({bend:b.id,startSeconds:i*seconds,seconds})),holdSeconds:2};
 const settings=await cadProjectSettings(workspace),directory=path.join(workspace,settings.buildDirectory,'fold-playback');
 await fs.mkdir(directory,{recursive:true});const playbackFile=path.join(directory,createHash('sha256').update(JSON.stringify(solution)).digest('hex')+'.json');
 await fs.writeFile(playbackFile,JSON.stringify(solution));
 const result={entry,sourceRevision:built.revision,playbackFile,durationSeconds:definition.bends.length*seconds+2,manufacturingSequence:false};
 if(show){
  let client;
  try{
   client=await connectEditor(workspace);
   const call=async(name,args)=>{const r=await client.callTool({name,arguments:{workspace,...args}},undefined,{timeout:90000}),text=r.content?.find(c=>c.type==='text')?.text;if(r.isError)throw Error(text??'Canvas request failed');return JSON.parse(text);};
   await call('open_cad_model',{file:entry});
   const deadline=Date.now()+45000;
   while(true){
    try{result.display=await call('canvas_command',{target:'cad',entry,action:'motion',options:{action:'play-fold',solutionFile:path.relative(workspace,playbackFile)}});break;}
    catch(error){if(Date.now()>=deadline||!/building|built successfully|not ready/i.test(error.message))throw error;await new Promise(r=>setTimeout(r,500));}
   }
  }catch(error){result.display={ok:false,error:error.message};}finally{await client?.close();}
 }
 return result;
}
