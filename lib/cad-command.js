import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {resolveNativePython} from '../vendor/cad-core/src/native/client.js';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {projectLayout,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadProjectSettings} from './cad-project.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';

export async function cadCommand(command,options) {
 const workspace=path.resolve(options.workspace??process.cwd()),settings=await cadProjectSettings(workspace);
 if(options.entry){relativePath(options.entry);settings.entryPoint=options.entry;}
 const worker=path.join(runtimeRoot,...(bundledRuntime?['cad-worker.py']:['vendor','cad-core','src','native','worker.py']));
 const session=new NativeCadSession({layout:await projectLayout(workspace,settings),python:resolveNativePython({explicit:options.python,environment:process.env.CADCOVE_PYTHON,project:settings.pythonPath,root:workspace}),worker,onLog:text=>process.stderr.write(text)});
 const discover=async request=>{
  const args={ids:request.ids??null,decisions:request.decisions??null};
  const code=`import json
from discovery import discover, review
args=json.loads(${JSON.stringify(JSON.stringify(args))})
result=discover(parts,cache_dir=ctx.build_dir / 'mechanism-analysis',ids=args['ids'])
if args['decisions'] is not None: result['review']=review(result,args['decisions'])`;
  return session.inspect(code);
 };
 const operation=async request=>{
  if(request.op==='references')return session.inspect(`import json\nfrom cad_references import inspect_references\nresult=inspect_references(parts,json.loads(${JSON.stringify(JSON.stringify(request.references))}))`);
  if(request.op==='discover')return discover(request);
  if(request.op==='build')return session.build();
  if(request.op==='inspect'){if(typeof request.code!=='string'||request.code.length>1000000)throw Error('inspect requires Python code');return session.inspect(request.code);}
  if(request.op==='export'){if(typeof request.output!=='string')throw Error('export requires output path');return session.export(request.output,request.ids);}
  throw Error('Use build, inspect, discover, references, or export');
 };
 let lines,stopping=false;const stop=()=>{stopping=true;session.dispose();lines?.close();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 try{
  if(command==='cad-session'){
   // JSONL provides warm builds without a daemon, network listener or editor.
   // The caller owns stdin; EOF/cancel always releases the Python process.
   lines=createInterface({input:process.stdin,crlfDelay:Infinity});
   for await(const line of lines){
    if(stopping)break;
    let request;try{if(line.length>1000000)throw Error('Request exceeds 1 MB');request=JSON.parse(line);const result=await operation(request);console.log(JSON.stringify({id:request.id??null,...result}));}
    catch(error){console.log(JSON.stringify({id:request?.id??null,ok:false,error:error.message}));}
   }
   return;
  }
  if(command==='cad-discover'&&!options.output)throw Error('--output REPORT.json is required');
  if(command==='cad-references'&&!options.input)throw Error('--input REFERENCES.json is required');
  const built=await session.build();
  if(command==='cad-build')return built;
  if(command==='cad-references')return await operation({op:'references',references:JSON.parse(await fs.readFile(path.resolve(options.input),'utf8'))});
  if(command==='cad-discover'){
   const response=await discover({ids:options.ids?.split(','),decisions:options.decisions?JSON.parse(await fs.readFile(path.resolve(options.decisions),'utf8')):undefined});
   const output=path.resolve(options.output);
   // Preserve existing review evidence; callers choose a new report path.
   await fs.mkdir(path.dirname(output),{recursive:true});
   await fs.writeFile(output,JSON.stringify(response,null,2)+'\n',{flag:'wx'});
   return {ok:true,revision:response.revision,output,parts:response.result.parts.length,candidates:response.result.candidates.length,cache:response.result.cache,coverage:response.result.coverage,unsupported:response.result.unsupported,review:response.result.review??null};
  }
  if(command==='cad-inspect'){if(!options.script)throw Error('--script FILE.py is required');return await session.inspect(await fs.readFile(path.resolve(options.script),'utf8'));}
  if(command==='cad-export'){if(!options.output)throw Error('--output FILE.step is required');return await session.export(options.output);}
  throw Error('Unknown native CAD command');
 }finally{session.dispose();process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
