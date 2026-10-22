// Headless design services. Dependencies are explicit, optional and never installed here.
import path from 'node:path';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';
export async function designCommand(command,options){
 const sketch=command==='cad-sketch';
 const action=options.action??'capabilities';
 if(action==='capabilities')return sketch
  ? {ok:true,experimental:true,solver:'PlaneGCS',package:'planegcs==0.9.6',commands:['capabilities','solve'],units:'mm',requiresEditor:false}
  : {ok:true,experimental:true,commands:['capabilities','prepare','solve'],analysis:['linearStatic'],units:'mm-N-MPa',solving:true,backend:'external FreeCAD/Gmsh/CalculiX',scope:'single solid, fully fixed faces, distributed face forces',requiresEditor:false};
 if(!sketch&&action==='solve'){const {analysisSolve}=await import('./analysis-command.js');return analysisSolve(options);}
 if(!sketch&&action==='prepare'&&options.workspace){const {analysisPrepare}=await import('./analysis-command.js');return analysisPrepare(options);}
 if(action!==(sketch?'solve':'prepare')||!options.input||!options.output)throw Error(`Use ${command} --action ${sketch?'solve':'prepare'} --input REQUEST.json --output NEW_RESULT.json`);
 const name=sketch?'sketch_solver.py':'fea_request.py';
 const script=path.join(runtimeRoot,...(bundledRuntime?[name]:['vendor','cad-core','src','native',name]));
 const p=Bun.spawn([options.python??process.env.CADCOVE_SKETCH_PYTHON??process.env.CADCOVE_PYTHON??'python3',script,'--input',path.resolve(options.input),'--output',path.resolve(options.output)],{stdout:'pipe',stderr:'pipe'});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;p.kill();},60000);
 try{
  const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  if(timedOut)throw Error('Design service timed out after 60 seconds');
  let result;try{result=JSON.parse(stdout.trim());}catch{throw Error('Design service returned no structured result: '+stderr.slice(-2000));}
  if(code)throw Error(result.error??stderr.slice(-2000));
  return {...result,output:path.resolve(options.output)};
 }finally{clearTimeout(timer);}
}
