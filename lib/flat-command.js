import fs from 'node:fs/promises';
import path from 'node:path';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {resolveNativePython} from '../vendor/cad-core/src/native/client.js';
import {projectLayout,relativePath} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadProjectSettings} from './cad-project.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';
import {connectEditor} from './mcp-proxy.js';
const native=name=>path.join(runtimeRoot,...(bundledRuntime?[name==='worker.py'?'cad-worker.py':name]:['vendor','cad-core','src','native',name]));

export async function showSvg(workspace,file){
 const client=await connectEditor(workspace);
 try{
  const result=await client.callTool({name:'open_svg_preview',arguments:{workspace,file}});
  const text=result.content?.find(c=>c.type==='text')?.text;
  if(result.isError)throw Error(text??'SVG preview failed');return JSON.parse(text);
 }finally{await client.close();}
}
export async function flatCommand(options={}){
 const action=options.action??'capabilities',workspace=path.resolve(options.workspace??process.cwd());
 if(action==='capabilities')return {ok:true,commands:['export','preview','show'],formats:['dxf','svg'],units:'mm',scale:1,backend:'CadQuery/ezdxf',requiresFreeCAD:false,scope:'one constant-section solid with through holes',preview:'SVG rendered from DXF; VS Code image preview via open_svg_preview',limitations:['No bent sheet unfolding, pockets, countersinks, CAM or cutter compensation','DXF preview accepts planar XY line/arc/circle/ellipse/spline/polyline geometry with declared mm or inch units']};
 if(action==='show'){
  if(!options.input)throw Error('Show requires --input FILE.svg');
  return showSvg(workspace,path.resolve(options.input));
 }
 if(!['export','preview'].includes(action))throw Error('Flat action must be capabilities, export, preview or show');
 if(!options.input||!options.output)throw Error('Flat export/preview requires --input FILE --output NEW_DIRECTORY');
 const output=path.resolve(options.output);
 try{await fs.stat(output);throw Error('Flat output already exists: '+output);}catch(e){if(e.code!=='ENOENT')throw e;}
 const settings=await cadProjectSettings(workspace);
 const python=resolveNativePython({explicit:options.python,environment:process.env.CADCOVE_PYTHON,project:settings.pythonPath,root:workspace});
 let result;
 if(action==='preview'){
  const p=Bun.spawn([python,native('dxf_preview.py'),'--input',path.resolve(options.input),'--output',path.join(output,'profile.svg')],{stdout:'pipe',stderr:'pipe'});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;p.kill();},60000);
  try{
   const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
   if(timedOut)throw Error('DXF preview timed out after 60 seconds');
   try{result=JSON.parse(stdout);}catch{throw Error('DXF preview failed: '+stderr.slice(-2000));}
   if(code||!result.ok)throw Error(result.error??'DXF preview failed');
  }finally{clearTimeout(timer);}
 }else{
  if(options.entry){relativePath(options.entry);settings.entryPoint=options.entry;}
  const request=JSON.parse(await fs.readFile(path.resolve(options.input),'utf8'));
  const session=new NativeCadSession({layout:await projectLayout(workspace,settings),python,worker:native('worker.py'),onLog:text=>process.stderr.write(text)});
  try{
   await session.build();
   const exported=await session.inspect(`import json\nfrom flat_export import export_flat\nresult=export_flat(parts,json.loads(${JSON.stringify(JSON.stringify(request))}),${JSON.stringify(output)})`);
   result={...exported.result,sourceRevision:exported.revision};
  }finally{session.dispose();}
 }
 result={...result,output,svg:path.join(output,'profile.svg'),...(action==='export'?{dxf:path.join(output,'profile.dxf')}:{})};
 await fs.writeFile(path.join(output,'source.json'),JSON.stringify(result,null,2),{flag:'wx'});
 if(options.show){
  try{result.display=await showSvg(workspace,result.svg);}catch(error){result.display={ok:false,error:error.message};}
 }
 return result;
}
