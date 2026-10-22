import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import {svgPreviewFile} from '../../../lib/svg-preview.js';
import {randomUUID} from 'node:crypto';
import {startMcpServer,z} from '../../../lib/mcp-server.js';
import {cadFeedback} from '../../../lib/cad-feedback.js';
import {sessionRequest} from '../../../lib/simulation-client.js';
import {viewerRequest} from '../../../lib/viewer-client.js';
import {chooseCanvas,canvasMotionInput} from '../../../lib/canvas-router.js';
import {relativePath} from '../../../vendor/cad-core/extensions/vscode/src/project-files.js';

export function registerMcp(context,{workspace,simulationProject,robots,mechanisms,cad,cli,startSimulation,stopSimulation,playTeamWorkspace,output}){
 const changed=new vscode.EventEmitter(),instance=randomUUID();let serverPromise,closed=false;
 const records=new Set();
 const schema={workspace:z.string().optional().describe('Open workspace folder name or absolute path. Omit for the current single workspace.')};
 function resource(args){
  if(!args.workspace)return undefined;
  const folder=vscode.workspace.workspaceFolders?.find(f=>f.name===args.workspace||f.uri.fsPath===args.workspace);
  if(!folder)throw Error('Choose an already open workspace folder');return folder.uri;
 }
 async function project(args){const root=workspace(resource(args)),file=await simulationProject(root),profile=JSON.parse(await fs.readFile(file,'utf8'));return {root,profilePath:file,build:path.resolve(path.dirname(file),profile.build)};}
 const imageResult=async report=>({content:[{type:'text',text:JSON.stringify({...report,image:undefined})},{type:'image',mimeType:'image/png',data:(await fs.readFile(report.image)).toString('base64')}]});
 async function canvasRequest(a,method,args={}){
  const root=workspace(resource(a)),canvases=[...(cad.canvases?.(root)??[]).map(c=>({...c,kind:'cad'})),...(mechanisms.canvases?.(root)??[])];
  const chosen=chooseCanvas(canvases,{target:a.target??(a.entry?'cad':'active'),entry:a.entry});
  args=await canvasMotionInput(root,method,args);
  if(chosen.kind==='field')return mechanisms.request(resource(a),'command',{method,args});
  if(['place','physics','motors','zero','cad'].includes(method))throw Error('This canvas does not support '+method+'; open field preview for that capability');
  const result=await cad.request(root,chosen.entry,method,args);
  if(method==='capabilities')return {...result,commands:[...result.commands,'capture'],target:'cad'};
  return result;
 }
 const tools=[
  {name:'open_svg_preview',description:'Display an existing workspace SVG in the VS Code image preview, including DXF previews from cadcove cad-flat. Does not execute CAD or SVG scripts. file is absolute or workspace-relative. Use after generating an export when the user asks to see it.',schema:{...schema,file:z.string().min(1)},run:async a=>{
   const artifact=await svgPreviewFile(workspace(resource(a)),a.file);
   await vscode.commands.executeCommand('vscode.openWith',vscode.Uri.file(artifact.file),'imagePreview.previewEditor');
   return {ok:true,...artifact,viewer:'VS Code image preview'};
  }},
  {name:'canvas_command',description:'Unified controls for the active CAD or field canvas. Query capabilities first. Common actions: state, selection, highlight, opacity, visibility, reveal, view, motion, capture. Field adds place, physics, motors, zero, cad. All lengths including camera and placement use mm; joint angles degrees, time seconds. Explicit target/entry resolves multiple hidden canvases. Opacity options: action set/reset/state, scope only/except/all, ids or exact names (defaults to selection), value 0 invisible to 1 opaque. For solved motion use options {action: play-solved, solutionFile: workspace-relative JSON path}; this loads large trajectories locally (32 MiB maximum). Existing cad tools are compatibility aliases.',schema:{...schema,target:z.enum(['active','cad','field']).optional(),entry:z.string().optional(),action:z.enum(['capabilities','state','selection','highlight','opacity','visibility','reveal','view','motion','capture','place','physics','motors','zero','cad']),options:z.record(z.string(),z.unknown()).optional()},run:a=>canvasRequest(a,a.action,a.options??{})},
  {name:'open_mechanism_preview',description:'Open current native CAD meshes in a shared motion/physics preview. Optional field is visual context, with no WPILib or Java. Cached geometry must match current source.',schema:{...schema,field:z.boolean().optional()},run:a=>mechanisms.open(resource(a),{field:a.field??false})},
  {name:'mechanism_preview',description:'Control the open preview: state includes selected robot or field part IDs/names; selection reads selection or sets ids; visibility hides/shows/isolates parts. motion uses the CAD trajectory API; place takes position in metres; physics starts an explicitly defined native world; motors takes volts by motor ID and seconds (maximum 30). cad closes physics and restores bind pose. Field is visual context only. capture returns a local PNG path.',schema:{...schema,action:z.enum(['state','view','capture','selection','visibility','place','motion','physics','motors','zero','cad']),options:z.record(z.string(),z.unknown()).optional()},run:a=>mechanisms.request(resource(a),a.action,a.options??{})},
  {name:'cad_visibility',description:'Hide parts, show parts, isolate (hide everything except target parts), or show-all. Omit ids/names to use current user selection. Names match exact CAD names case-insensitively and include all occurrences with that name; unknown names/IDs fail without changes. Temporary canvas visibility persists until show-all, Escape or rebuild; preserves CAD, camera and highlights. State reports hiddenIds.',schema:{...schema,entry:z.string().optional(),action:z.enum(['hide','show','isolate','show-all','state']),ids:z.array(z.string()).min(1).optional(),names:z.array(z.string().min(1)).min(1).optional()},run:async a=>{
   const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));
   return canvasRequest(a,'visibility',{action:a.action,ids:a.ids,names:a.names});
  }},
  {name:'cad_reveal',description:'Temporarily alternate the current assembly view with only chosen parts so hidden components can be seen. Defaults to current agent highlights, 2 cycles, 1250ms per phase. Restores prior visibility at completion/stop; Escape shows all parts without changing camera, CAD or highlights. Stop and state actions are available.',schema:{...schema,entry:z.string().optional(),action:z.enum(['start','stop','state']),ids:z.array(z.string()).min(1).max(200).optional(),cycles:z.number().int().min(1).max(10).optional(),intervalMs:z.number().int().min(500).max(5000).optional()},run:async a=>{
   const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));
   return canvasRequest(a,'reveal',{action:a.action,ids:a.ids,cycles:a.cycles,intervalMs:a.intervalMs});
  }},
  {name:'cad_view',description:'Read or control the live CAD camera. Supports named view angles, fit all or exact part IDs, world-space pan in mm, zoom as a positive distance multiplier (<1 zooms in), and explicit camera target/distance in mm with yaw/pitch in radians. Preserves highlights and selection. Empty options reads camera.',schema:{...schema,entry:z.string().optional(),options:z.object({view:z.enum(['iso','front','back','right','left','top','bottom']).optional(),fit:z.boolean().optional(),ids:z.array(z.string()).min(1).optional(),pan:z.array(z.number().finite()).length(3).optional(),zoom:z.number().positive().finite().optional(),camera:z.object({target:z.array(z.number().finite()).length(3).optional(),distance:z.number().positive().finite().optional(),yaw:z.number().finite().optional(),pitch:z.number().positive().lt(Math.PI).optional()}).strict().optional()}).strict().optional()},run:async a=>{
   const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));
   return canvasRequest(a,'view',a.options??{});
  }},
  {name:'cad_highlight',description:'Highlight one or multiple CAD occurrences with temporary renderer colors. Default cyan is distinct from yellow user selection. Optional per-part colors distinguish groups. Does not alter CAD or selection; follows motion. Set replaces highlights, clear removes them, state reads them. Escape clears highlights and selection.',schema:{...schema,entry:z.string().optional(),action:z.enum(['set','clear','state']),parts:z.array(z.object({id:z.string().min(1),color:z.string().regex(/^#[a-f0-9]{6}$/i).optional()}).strict()).max(200).optional()},run:async a=>{
   const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));
   return canvasRequest(a,'highlight',{action:a.action,parts:a.parts});
  }},
  {name:'cad_selection',description:'Read highlighted CAD part occurrence IDs and names from the open canvas. Click to select; Ctrl/Cmd-click toggles multiple parts.',schema:{...schema,entry:z.string().optional()},readOnly:true,run:async a=>{const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));return canvasRequest(a,'selection',{});}},
  {name:'cad_motion',description:'Rotate or animate CAD parts using mechanism.json joints and gear/belt/chain relations; temporary viewer poses, no geometry rebuild or physical motor commands.',schema:{...schema,entry:z.string().optional(),action:z.enum(['rotate','move','animate','play','pause','resume','seek','list','stop','reset','state']),part:z.string().optional(),degrees:z.number().finite().optional(),rpm:z.number().finite().optional(),seconds:z.number().min(0).max(300).optional(),trajectory:z.object({units:z.literal('deg-s'),repeat:z.number().int().min(1).max(1000).optional(),tracks:z.array(z.object({target:z.string(),startSeconds:z.number().min(0).max(300).optional(),velocity:z.number().finite().optional(),acceleration:z.number().finite().optional(),endPosition:z.number().finite().optional(),segments:z.array(z.object({seconds:z.number().positive().max(300),acceleration:z.number().finite().optional(),jerk:z.number().finite().optional()}).strict()).min(1).max(1000)}).strict()).min(1).max(100)}).strict().optional()},run:async a=>{
   const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));
   return canvasRequest(a,'motion',{action:a.action,part:a.part,degrees:a.degrees,rpm:a.rpm,seconds:a.seconds,trajectory:a.trajectory});
  }},
  {name:'cad_capture',description:'Capture the current source model with WebGPU, fit selected part IDs, preserve the interactive camera.',schema:{...schema,entry:z.string().optional(),view:z.enum(['iso','front','back','left','right','top','bottom']).default('iso'),ids:z.array(z.string()).optional()},readOnly:true,run:async a=>{
   const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));
   const frame=await canvasRequest(a,'capture',{view:a.view,ids:a.ids});
   return {content:[{type:'text',text:JSON.stringify({...frame,image:undefined})},{type:'image',mimeType:'image/png',data:frame.image.startsWith('data:image/png;base64,')?frame.image.slice(22):(await fs.readFile(frame.image)).toString('base64')}]};
  }},
  {name:'open_robot_cad',description:'Open/show this workspace’s robot CAD immediately. Reuses CAD source or imported full robot assembly with colors. Does not start physics, load the field, or require Java. Use first for “open robot cad”.',schema,run:a=>robots.open(resource(a))},
  {name:'workspace_context',description:'Get configured source, build and robot paths and focused next steps without searching project files.',schema,readOnly:true,run:async a=>{const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));return {ok:true,workspace:root,config,robotViews:robots.diagnostics(),guide:'.cadcove/AGENT.md',canvasControl:'canvas_command; query capabilities; common lengths mm; target active, cad or field',next:'Open robot CAD with open_robot_cad. Edit the configured CAD source (Python or JavaScript) or robot source with normal editor tools; validate using cad_status/capture_scene or simulation_state.'};}},
  {name:'open_cad_model',description:'Open an editable Python/CadQuery or JavaScript model under the configured CAD source directory. Omit file to use entryPoint.',schema:{...schema,file:z.string().optional()},run:async a=>{const root=workspace(resource(a)),config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));const file=a.file??config.entryPoint;relativePath(file);if(config.sourceDirectory!=='.')relativePath(config.sourceDirectory);await cad.openModel(vscode.Uri.file(path.join(root,config.sourceDirectory,file)));return {ok:true,file};}},
  {name:'cad_status',description:'Read current source/build revision and errors after an edit, or imported robot view readiness.',schema,readOnly:true,run:async a=>{const root=workspace(resource(a));const imported=robots.diagnostics().find(s=>s.workspace===root);return imported?{ok:imported.phase==='ready',...imported}:cadFeedback(root);}},
  {name:'start_simulation',description:'Start the configured robot program/physics and open its live view. WPILib Driver Station owns enable/disable and controller input.',schema,run:async a=>{await playTeamWorkspace(resource(a));return {ok:true,input:'Use WPILib Driver Station and physical controllers; the canvas is view-only.'};}},
  {name:'stop_simulation',description:'Stop the configured robot simulation.',schema,run:a=>stopSimulation(resource(a))},
  {name:'simulation_state',description:'Read the running simulator state, performance and pose. Does not start a simulation.',schema,readOnly:true,run:async a=>sessionRequest(await project(a),'state',{timeout:3000})},
  {name:'simulation_objects',description:'Query running simulation objects without an image.',schema,readOnly:true,run:async a=>sessionRequest(await project(a),'objects',{timeout:3000})},
  {name:'check_project',description:'Diagnose simulation prerequisites when startup fails. Not needed for opening CAD.',schema,readOnly:true,run:async a=>{const p=await project(a);return cli(['doctor','--project',p.profilePath],p.root);}},
  {name:'capture_scene',description:'Get an image for visual feedback from robot CAD, a source build preview, or the live simulator.',schema:{...schema,scene:z.enum(['cad','simulation']).default('cad'),view:z.enum(['iso','front','back','left','right','top','bottom']).default('iso')},readOnly:true,run:async a=>{
   if(a.scene==='simulation'){const report=await viewerRequest(await project(a),'capture',{scope:'robot',view:a.view,width:960,height:720});return imageResult(report);}
   const root=workspace(resource(a));if(robots.diagnostics().some(s=>s.workspace===root)){const frame=await robots.request(resource(a),'capture',{view:a.view,width:960,height:720});return {content:[{type:'text',text:JSON.stringify({...frame,image:undefined})},{type:'image',mimeType:'image/png',data:frame.image.startsWith('data:image/png;base64,')?frame.image.slice(22):(await fs.readFile(frame.image)).toString('base64')}]};}
   const report=await cadFeedback(root,{preview:true});return report.ok?imageResult(report):report;
  }},
  {name:'set_camera',description:'Fit or select a standard camera view in imported robot CAD or the live simulator.',schema:{...schema,scene:z.enum(['cad','simulation']).default('cad'),view:z.enum(['iso','front','back','left','right','top','bottom']).default('iso')},run:async a=>a.scene==='simulation'?viewerRequest(await project(a),'view',{view:a.view,fit:true}):robots.request(resource(a),'view',{view:a.view,fit:true})},
 ];
 async function start(){
  if(closed)throw Error('CadCove is closed');
  if(!vscode.workspace.isTrusted)throw Error('Trust the workspace before starting CadCove MCP');
  if(!serverPromise)serverPromise=(async()=>{
   const server=await startMcpServer({tools,allowed:()=>!closed&&vscode.workspace.isTrusted});
   if(closed){await server.close();throw Error('CadCove closed during startup');}
   await writeDescriptors(server);output.appendLine('CadCove MCP ready (local, authenticated).');return server;
  })().catch(e=>{serverPromise=undefined;throw e;});
  return serverPromise;
 }
 async function writeDescriptors(server){
  for(const folder of vscode.workspace.workspaceFolders??[]){
   if(folder.uri.scheme!=='file')continue;
   const root=folder.uri.fsPath;
   try{
    const config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));relativePath(config.buildDirectory);
    let dir=root;for(const part of config.buildDirectory.split('/')){dir=path.join(dir,part);await fs.mkdir(dir).catch(e=>{if(e.code!=='EEXIST')throw e;});if(!(await fs.lstat(dir)).isDirectory())throw Error('Unsafe MCP cache directory');}
    const file=path.join(dir,'cadcove-mcp.json'),temp=file+'.'+instance;
    await fs.writeFile(temp,JSON.stringify({schema:1,instance,workspace:root,endpoint:server.url,token:server.token}),{mode:0o600,flag:'wx'});await fs.rename(temp,file);records.add(file);
   }catch(error){if(error.code!=='ENOENT')output.appendLine('MCP workspace discovery: '+error.message);}
  }
 }
 if(vscode.lm?.registerMcpServerDefinitionProvider)context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('cadcove.mcp',{
  onDidChangeMcpServerDefinitions:changed.event,
  async provideMcpServerDefinitions(){const server=await start();return [new vscode.McpHttpServerDefinition('CadCove',vscode.Uri.parse(server.url),{Authorization:'Bearer '+server.token},'0.1.1')];},
 }));
 // CLI discovery follows the configured build directory when projects change.
 // Serialize refreshes so rapid saves cannot race the exclusive temporary file.
 let descriptorWrites=Promise.resolve();
 const refresh=()=>{descriptorWrites=descriptorWrites.then(async()=>{if(!closed&&serverPromise)await writeDescriptors(await serverPromise);}).catch(e=>output.appendLine('MCP workspace discovery: '+e.message));};
 const projectWatcher=vscode.workspace.createFileSystemWatcher('**/.cadcove/project.json');
 context.subscriptions.push(projectWatcher,projectWatcher.onDidChange(refresh),projectWatcher.onDidCreate(refresh));
 context.subscriptions.push(changed,vscode.workspace.onDidChangeWorkspaceFolders(()=>{refresh();changed.fire();}),vscode.workspace.onDidGrantWorkspaceTrust(()=>{void start().then(()=>changed.fire()).catch(e=>output.appendLine(e.message));}));
 async function close(){closed=true;await descriptorWrites;await serverPromise?.then(s=>s.close()).catch(()=>{});for(const file of records)try{const record=JSON.parse(await fs.readFile(file,'utf8'));if(record.instance===instance)await fs.unlink(file);}catch{}}
 context.subscriptions.push({dispose:()=>{void close();}});
 if(vscode.workspace.isTrusted)void start().catch(e=>output.appendLine('MCP startup: '+e.message));
 return {start,close,refresh:async()=>{await writeDescriptors(await start());changed.fire();}};
}
