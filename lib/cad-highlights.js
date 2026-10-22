import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {connectEditor} from './mcp-proxy.js';
export async function cadHighlights(command,options){
 const workspace=path.resolve(options.workspace??process.cwd());
 let input={};
 if(command==='cad-highlight'){
  if(!options.input)throw Error('--input highlights.json is required');
  input=JSON.parse(await readFile(path.resolve(options.input),'utf8'));
  if(!input||Array.isArray(input)||!Array.isArray(input.parts)||Object.keys(input).some(k=>!['parts'].includes(k)))throw Error('Expected {parts:[{id,color?}]}');
 }
 const client=await connectEditor(workspace);
 try{
  const result=await client.callTool({name:'cad_highlight',arguments:{workspace,entry:options.entry,...input,action:command==='cad-highlight'?'set':command==='cad-clear-highlights'?'clear':'state'}});
  const message=result.content?.find(c=>c.type==='text')?.text;
  if(result.isError)throw Error(message??'CAD highlights failed');return JSON.parse(message);
 }finally{await client.close();}
}
