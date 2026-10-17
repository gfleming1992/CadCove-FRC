import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {projectLayout,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadProjectSettings} from './cad-project.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';

export async function cadCommand(command,options) {
 const workspace=path.resolve(options.workspace??process.cwd()),settings=await cadProjectSettings(workspace);
 if(options.entry){relativePath(options.entry);settings.entryPoint=options.entry;}
 const config=JSON.parse(await fs.readFile(path.join(workspace,'.cadcove/project.json'),'utf8'));
 const worker=path.join(runtimeRoot,...(bundledRuntime?['cad-worker.py']:['vendor','cad-core','src','native','worker.py']));
 const session=new NativeCadSession({layout:await projectLayout(workspace,settings),python:options.python??process.env.CADCOVE_PYTHON??config.pythonPath??'python3',worker,onLog:text=>process.stderr.write(text)});
 const operation=async request=>{
  if(request.op==='build')return session.build();
  if(request.op==='inspect'){if(typeof request.code!=='string'||request.code.length>1000000)throw Error('inspect requires Python code');return session.inspect(request.code);}
  if(request.op==='export'){if(typeof request.output!=='string')throw Error('export requires output path');return session.export(request.output,request.ids);}
  throw Error('Use build, inspect, or export');
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
  const built=await session.build();
  if(command==='cad-build')return built;
  if(command==='cad-inspect'){if(!options.script)throw Error('--script FILE.py is required');return session.inspect(await fs.readFile(path.resolve(options.script),'utf8'));}
  if(command==='cad-export'){if(!options.output)throw Error('--output FILE.step is required');return session.export(options.output);}
  throw Error('Unknown native CAD command');
 }finally{session.dispose();process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}
