import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {connectEditor} from './mcp-proxy.js';
export async function captureCad(options){
 if(!options.output)throw Error('--output FILE.png is required');
 const workspace=path.resolve(options.workspace??process.cwd()),client=await connectEditor(workspace);
 try{
  const report=await client.callTool({name:'cad_capture',arguments:{workspace,entry:options.entry,view:options.view??'iso',ids:options.ids?.split(',')}},undefined,{timeout:120000});
  const image=report.content.find(x=>x.type==='image'),text=report.content.find(x=>x.type==='text');
  if(report.isError||!image)throw Error(text?.text??'Capture did not return an image');
  const output=path.resolve(options.output),bytes=Buffer.from(image.data,'base64');
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,bytes);
  return {ok:true,...JSON.parse(text.text),image:output,sha256:createHash('sha256').update(bytes).digest('hex')};
 }finally{await client.close();}
}
