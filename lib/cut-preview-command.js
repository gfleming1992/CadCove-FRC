import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateCutRequest} from '../vendor/cad-core/src/core/cut-motion.js';
import {cadProjectSettings} from './cad-project.js';
import {cadCommand} from './cad-command.js';
import {connectEditor} from './mcp-proxy.js';

export async function cutPreviewCommand(options={}){
 if((options.action??'capabilities')==='capabilities')return {ok:true,commands:['preview'],units:'mm-s',stock:'rectangular, planar',tools:['flat-end router','laser kerf'],moves:'explicit linear XYZ cut/rapid moves',playback:['pause','resume','seek','reset'],maximumCells:40000,sourceGeometryUnchanged:true,toolpathPlanning:false};
 if(options.action!=='preview'||!options.input||!options.output)throw Error('Use cad-cut-preview --action preview --input PATHS.json --output NEW_CAD_DIRECTORY [--show]');
 const workspace=await fs.realpath(path.resolve(options.workspace??process.cwd())),settings=await cadProjectSettings(workspace);
 const file=path.resolve(options.input);if((await fs.stat(file)).size>4*1024*1024)throw Error('Toolpath request exceeds 4 MiB');
 const request=JSON.parse(await fs.readFile(file,'utf8')),checked=validateCutRequest(request);
 const source=await fs.realpath(path.join(workspace,settings.sourceDirectory)),output=path.resolve(options.output),parent=await fs.realpath(path.dirname(output));
 const relative=path.relative(source,path.join(parent,path.basename(output)));
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Cut preview output must be a new directory inside the configured CAD source directory');
 await fs.mkdir(output); // no overwrite, including pre-existing symlinks
 const entry=path.join(relative,'models.py').split(path.sep).join('/');
 const stock=request.stock,tool=request.tool;
 const sourceCode=`# Generated stock-removal presentation; no source part or CAM program is changed.
import cadquery as cq
def build(ctx):
 stock=cq.Solid.makeBox(${stock.size.join(',')},cq.Vector(${stock.origin.join(',')}))
 tool=cq.Solid.makeCylinder(${tool.diameterMm/2},${tool.lengthMm})
 return [dict(id=${JSON.stringify(stock.id)},shape=stock,color='#aabacb'),dict(id=${JSON.stringify(tool.id)},shape=tool,color='${tool.kind==='laser'?'#ed564f':'#e6a33d'}')]
`;
 await fs.writeFile(path.join(output,'models.py'),sourceCode,{flag:'wx'});
 await fs.writeFile(path.join(output,'paths.json'),JSON.stringify(request,null,2),{flag:'wx'});
 const built=await cadCommand('cad-build',{workspace,entry,python:options.python});
 const plan={...request,sourceRevision:built.revision};
 const directory=path.join(workspace,settings.buildDirectory,'cut-playback');await fs.mkdir(directory,{recursive:true});
 const playbackFile=path.join(directory,createHash('sha256').update(JSON.stringify(plan)).digest('hex')+'.json');await fs.writeFile(playbackFile,JSON.stringify(plan));
 const result={ok:true,entry,sourceRevision:built.revision,playbackFile,durationSeconds:checked.duration,approximation:{method:'cell-centre stock columns',cellSizeMm:[checked.dx,checked.dy],maximumXYBoundaryErrorMm:Math.hypot(checked.dx,checked.dy)/2},retainsFinishedPartAndScrap:true,toolpathPlanning:false};
 if(options.show){let client;try{
  client=await connectEditor(workspace);
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:{workspace,...args}},undefined,{timeout:90000}),text=r.content?.find(c=>c.type==='text')?.text;if(r.isError)throw Error(text??'Canvas request failed');return JSON.parse(text);};
  await call('open_cad_model',{file:entry});
  const deadline=Date.now()+45000;
  while(true){try{result.display=await call('canvas_command',{target:'cad',entry,action:'motion',options:{action:'play-cut',solutionFile:path.relative(workspace,playbackFile)}});break;}catch(e){if(Date.now()>=deadline||!/building|built successfully|not ready/i.test(e.message))throw e;await new Promise(r=>setTimeout(r,500));}}
 }catch(e){result.display={ok:false,error:e.message};}finally{await client?.close();}}
 return result;
}
