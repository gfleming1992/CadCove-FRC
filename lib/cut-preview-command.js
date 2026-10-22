import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateCutRequest} from '../vendor/cad-core/src/core/cut-motion.js';
import {cadProjectSettings} from './cad-project.js';
import {cadCommand} from './cad-command.js';
import {connectEditor} from './mcp-proxy.js';

export async function cutPreviewCommand(options={}){
 if((options.action??'capabilities')==='capabilities')return {ok:true,commands:['preview'],units:'mm-s',stock:'rectangular, planar',tools:['bit','laser'],toolAliases:{router:'bit'},visuals:{bit:'two-flute end mill and short shank',laser:'compact nozzle and red beam to stock surface'},moves:'explicit linear XYZ cut/rapid moves',playback:['pause','resume','seek','reset'],maximumCells:40000,sourceGeometryUnchanged:true,toolpathPlanning:false};
 if(options.action!=='preview'||!options.input||!options.output)throw Error('Use cad-cut-preview --action preview --input PATHS.json --output NEW_CAD_DIRECTORY [--show]');
 const workspace=await fs.realpath(path.resolve(options.workspace??process.cwd())),settings=await cadProjectSettings(workspace);
 const file=path.resolve(options.input);if((await fs.stat(file)).size>4*1024*1024)throw Error('Toolpath request exceeds 4 MiB');
 const request=JSON.parse(await fs.readFile(file,'utf8'));
 if(request.tool?.kind==='laser')request.tool.nozzleId??=request.tool.id+'-nozzle';
 const checked=validateCutRequest(request);
 const source=await fs.realpath(path.join(workspace,settings.sourceDirectory)),output=path.resolve(options.output),parent=await fs.realpath(path.dirname(output));
 const relative=path.relative(source,path.join(parent,path.basename(output)));
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Cut preview output must be a new directory inside the configured CAD source directory');
 await fs.mkdir(output); // no overwrite, including pre-existing symlinks
 const entry=path.join(relative,'models.py').split(path.sep).join('/');
 const stock=request.stock,tool=request.tool;
 const bitSource=tool.kind==='laser'?'':`
def end_mill():
 radius=${tool.diameterMm/2}
 bit=cq.Solid.makeCylinder(radius,${tool.lengthMm})
 helix=cq.Wire.makeHelix(${Math.max(tool.diameterMm*11/3,tool.lengthMm/3)},${tool.lengthMm*.7},radius)
 flute=cq.Workplane('XZ').center(radius,0).circle(${tool.diameterMm*.2}).sweep(cq.Workplane(obj=helix),isFrenet=True).val()
 for angle in (0,180):
  bit=bit.cut(flute.rotate((0,0,0),(0,0,1),angle))
 assert bit.isValid()
 return bit
`;
 const nozzleRadius=Math.max(.8,Math.min(2,tool.diameterMm*3));
 const toolCode=tool.kind==='laser'?` tool=cq.Solid.makeCylinder(${Math.min(.1,tool.diameterMm/2)},1)
 nozzle=cq.Compound.makeCompound([cq.Solid.makeCone(.3,${nozzleRadius},3,cq.Vector(0,0,${tool.lengthMm})),cq.Solid.makeCylinder(${nozzleRadius},2,cq.Vector(0,0,${tool.lengthMm+3}))])`:' tool=end_mill()';
 const nozzlePart=tool.kind==='laser'?`,dict(id=${JSON.stringify(tool.nozzleId)},name='Laser nozzle',shape=nozzle,color='#707b89')`:'';
 const sourceCode=`# Generated stock-removal presentation; no source part or CAM program is changed.
import cadquery as cq
${bitSource}
def build(ctx):
 stock=cq.Solid.makeBox(${stock.size.join(',')},cq.Vector(${stock.origin.join(',')}))
${toolCode}
 return [dict(id=${JSON.stringify(stock.id)},shape=stock,color='#aabacb'),dict(id=${JSON.stringify(tool.id)},name='${tool.kind==='laser'?'Laser beam':'Two-flute end mill'}',shape=tool,color='${tool.kind==='laser'?'#ff3b30':'#d7b66b'}')${nozzlePart}]
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
