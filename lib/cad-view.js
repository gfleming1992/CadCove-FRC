import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {connectEditor} from './mcp-proxy.js';
export async function cadView(command,options){
 const workspace=path.resolve(options.workspace??process.cwd());
 if(['cad-view','cad-visibility'].includes(command)&&!options.options)throw Error('--options JSON_FILE is required');
 const view=options.options?JSON.parse(await readFile(path.resolve(options.options),'utf8')):{};
 const client=await connectEditor(workspace);
 try{
  const reveal=command.startsWith('cad-reveal'),visibility=command==='cad-visibility';
  const args=visibility?{...view,workspace,entry:options.entry}:reveal?{...view,workspace,entry:options.entry,action:command==='cad-reveal'?'start':command==='cad-reveal-stop'?'stop':'state'}:{workspace,entry:options.entry,options:view};
  const result=await client.callTool({name:visibility?'cad_visibility':reveal?'cad_reveal':'cad_view',arguments:args});
  const message=result.content?.find(c=>c.type==='text')?.text;
  if(result.isError)throw Error(message??'CAD canvas request failed');return JSON.parse(message);
 }finally{await client.close();}
}
