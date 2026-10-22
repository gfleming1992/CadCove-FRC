import fs from 'node:fs/promises';
import path from 'node:path';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {resolveNativePython} from '../vendor/cad-core/src/native/client.js';
import {projectLayout,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadProjectSettings} from './cad-project.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';

const native=name=>path.join(runtimeRoot,...(bundledRuntime?[name==='worker.py'?'cad-worker.py':name]:['vendor','cad-core','src','native',name]));
async function cadSession(options){
 const workspace=path.resolve(options.workspace??process.cwd()),settings=await cadProjectSettings(workspace);
 if(options.entry){relativePath(options.entry);settings.entryPoint=options.entry;}
 return new NativeCadSession({layout:await projectLayout(workspace,settings),python:resolveNativePython({explicit:options.python,environment:process.env.CADCOVE_PYTHON,project:settings.pythonPath,root:workspace}),worker:native('worker.py'),onLog:text=>process.stderr.write(text)});
}

export async function analysisPrepare(options){
 if(!options.input||!options.output)throw Error('Analysis prepare requires --input REQUEST.json --output NEW_REVIEW.json');
 const request=JSON.parse(await fs.readFile(path.resolve(options.input),'utf8')),output=path.resolve(options.output);
 const session=await cadSession(options);
 try{
  await session.build();
  const inspected=await session.inspect(`import json\nfrom fea_geometry import prepare_geometry\nresult=prepare_geometry(parts,json.loads(${JSON.stringify(JSON.stringify(request))}))`);
  const result={...inspected.result,sourceRevision:inspected.revision,output};
  await fs.writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});
  return result;
 }finally{session.dispose();}
}

// Optional external FEA backend. Explicit binaries, isolated preferences, new
// evidence directory, and current CAD/reference validation before any solve.
export async function analysisSolve(options){
 if(!options.input||!options.output)throw Error('Analysis solve requires --input REQUEST.json --output NEW_DIRECTORY');
 const binaries={CADCOVE_FREECAD:options.freecad??process.env.CADCOVE_FREECAD,CADCOVE_GMSH:options.gmsh??process.env.CADCOVE_GMSH,CADCOVE_CCX:options.ccx??process.env.CADCOVE_CCX};
 for(const [key,value] of Object.entries(binaries)){
  if(!value||!path.isAbsolute(value))throw Error(`Configure an absolute ${key} executable path`);
  await fs.access(value,fs.constants.X_OK);
 }
 const output=path.resolve(options.output),request=JSON.parse(await fs.readFile(path.resolve(options.input),'utf8'));
 const session=await cadSession(options);
 let exported;
 try{
  await session.build();
  exported=await session.inspect(`import json\nfrom fea_geometry import export_analysis\nresult=export_analysis(parts,json.loads(${JSON.stringify(JSON.stringify(request))}),${JSON.stringify(output)})`);
 }finally{session.dispose();}
 await fs.writeFile(path.join(output,'source.json'),JSON.stringify({revision:exported.revision,shapeHash:exported.result.shapeHash},null,2),{flag:'wx'});
 const log=await fs.open(path.join(output,'backend.log'),'wx');
 const p=Bun.spawn([binaries.CADCOVE_FREECAD,'-u',path.join(output,'user.cfg'),'-s',path.join(output,'system.cfg'),native('fea_freecad.py')],{env:{...process.env,...binaries,CADCOVE_FEA_JOB:output},stdin:'ignore',stdout:log.fd,stderr:log.fd});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;p.kill();},1100000);
 try{
  const code=await p.exited;
  if(timedOut)throw Error('FEA backend timed out; inspect '+path.join(output,'backend.log'));
  let result;try{result=JSON.parse(await fs.readFile(path.join(output,'result.json'),'utf8'));}catch{throw Error('FEA backend produced no structured result; inspect '+path.join(output,'backend.log'));}
  if(code||!result.ok)throw Error(result.error??'FEA backend failed');
  return {...result,sourceRevision:exported.revision,output};
 }finally{clearTimeout(timer);await log.close();}
}
