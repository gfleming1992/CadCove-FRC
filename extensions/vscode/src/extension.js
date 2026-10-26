import * as vscode from 'vscode';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {activate as activateCAD, deactivate as deactivateCAD} from '../../../vendor/cad-core/extensions/vscode/src/extension.js';
import {installRuntime} from '../../../lib/runtime-install.js';
import {cadProjectSettings} from '../../../lib/cad-project.js';
import {relativePath} from '../../../vendor/cad-core/extensions/vscode/src/project-files.js';
import {simulationPanels} from './simulation-panel.js';
import {robotPanels} from './robot-panel.js';
import {sceneServices} from './scene-services.js';
import {registerMcp} from './mcp.js';
import {SimulationTasks} from './simulation-tasks.js';
import {registerModelMenu} from './model-menu.js';
const execute = promisify(execFile);
let stopOwnedSimulations=async()=>{};

export function activate(context) {
  const modelMenu=registerModelMenu(vscode,context);
  const output=vscode.window.createOutputChannel('CadCove runtime');context.subscriptions.push(output);
  let runtime, installing;
  const cancellations=new Set();
  const tasks=new SimulationTasks(async record=>{
    try{
      // Use the already verified executable selected for this owned launch.
      // Shutdown must still work after trust is revoked or installation aborts;
      // it must not install/execute a newly selected runtime during deactivation.
      if(record.executable&&record.project)await execute(record.executable,['sim-stop','--project',record.project],{cwd:record.root,timeout:3000,maxBuffer:2*1024*1024,windowsHide:true});
    }catch(error){output.appendLine('Owned simulation shutdown: '+error.message);}
    finally{
      const until=Date.now()+5000;
      while(!record.ended&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));
      if(!record.ended)record.execution?.terminate();
    }
  });
  context.subscriptions.push({dispose(){for(const c of cancellations)c.abort();}});
  function trusted(){tasks.assertOpen();if(!vscode.workspace.isTrusted)throw Error('Trust this local workspace before running the toolbox.');}
  async function ensureRuntime({repair=false,signal,onProgress}={}){
    trusted();
    if(installing){
      if(!repair)return installing;
      try{await installing;}catch{/* A repair may follow a failed startup check. */}
      return ensureRuntime({repair,signal,onProgress});
    }
    if(runtime&&!repair)return runtime;
    if(repair){runtime=undefined;context.environmentVariableCollection.delete('PATH');}
    installing=(async()=>{
      const directory=path.join(context.extensionPath,'runtime');
      const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
      const cancellation=new AbortController();cancellations.add(cancellation);
      const abort=()=>cancellation.abort(signal.reason);
      if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
      try {
        const installed=await installRuntime({manifest,cacheDirectory:path.join(context.globalStorageUri.fsPath,'runtimes'),repair,signal:cancellation.signal,onProgress,
          // Offline platform VSIX includes the same pinned files as a release
          // download. The installer still checks every byte before activation.
          fetchImpl:async url=>{
            const file=manifest.files.find(f=>f.url===url);if(!file)throw Error('Unknown bundled runtime asset');
            return new Response(Readable.toWeb(createReadStream(path.join(directory,file.name))));
          }});
        trusted();
        runtime=path.join(installed.directory,process.platform==='win32'?'cadcove.exe':'cadcove');
        context.environmentVariableCollection.prepend('PATH',installed.directory+path.delimiter);
        context.environmentVariableCollection.description='CadCove runtime CLI for local CAD and simulation tasks.';
        output.appendLine(JSON.stringify({event:'runtime-ready',version:installed.manifest.version,directory:installed.directory,reused:installed.reused,repaired:installed.repaired}));
        return runtime;
      }finally{cancellations.delete(cancellation);signal?.removeEventListener('abort',abort);}
    })().finally(()=>{installing=undefined;});
    return installing;
  }
  async function repairRuntime(){
    trusted();
    return vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'CadCove: Verify and repair runtime',cancellable:true},async(progress,token)=>{
      const cancellation=new AbortController(),listener=token.onCancellationRequested(()=>cancellation.abort());
      if(token.isCancellationRequested)cancellation.abort();
      try{
        const executable=await ensureRuntime({repair:true,signal:cancellation.signal,onProgress:({file,received,bytes})=>progress.report({message:`${file}: ${Math.round(100*received/bytes)}%`})});
        output.appendLine('Runtime verified. Open a new toolbox terminal to use this installation; existing processes keep their previous runtime.');
        return {ok:true,executable};
      }finally{listener.dispose();}
    });
  }
  function workspace(resource){
    trusted();
    const uri=resource??vscode.window.activeTextEditor?.document.uri;
    const folder=uri?vscode.workspace.getWorkspaceFolder(uri):undefined;
    const selected=folder??(vscode.workspace.workspaceFolders?.length===1?vscode.workspace.workspaceFolders[0]:undefined);
    if(!selected||selected.uri.scheme!=='file')throw Error('Select a file in a local team workspace first.');
    return selected.uri.fsPath;
  }
  const settings=cadProjectSettings;
  const scenes=sceneServices({ensureRuntime,simulationProject,cli});
  const cad=activateCAD(context,{commandPrefix:'cadcove',viewType:'cadcove.model',outputName:'CadCove CAD',minimalUI:true,nativeStep:true,projectSettings:settings,integrate:scenes.integrate});
  async function cli(args,root,timeout=30000){
    const executable=await ensureRuntime();trusted();
    try {const {stdout}=await execute(executable,args,{cwd:root,timeout,maxBuffer:2*1024*1024,windowsHide:true});return JSON.parse(stdout);}
    catch(error){if(error.stdout){try{const report=JSON.parse(error.stdout);if(report.ok===false)return report;}catch{}}throw error;}
  }
  async function initialize(resource){const root=workspace(resource);const report=await cli(['init','--workspace',root],root);output.appendLine(JSON.stringify(report,null,2));if(!report.ok)throw Error(report.error?.message??'Initialization failed');await mcp.refresh();
    void vscode.window.showInformationMessage('CadCove is ready for CAD. AGENTS.md, CLAUDE.md and Copilot instructions point to the shared guide. Start a new agent conversation.', 'Open agent guide').then(choice=>{if(choice)return vscode.window.showTextDocument(vscode.Uri.file(path.join(root,'.cadcove/AGENT.md')));});
    return report;}
  async function updateGuidance(resource){const root=workspace(resource),report=await cli(['guidance-update','--workspace',root],root);output.appendLine(JSON.stringify(report,null,2));output.show(true);if(!report.ok)void vscode.window.showInformationMessage('CadCove guidance needs review. Team edits were preserved; proposal paths are in CadCove runtime output.');return report;}
  async function simulationProject(root){
    const config=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8'));
    const relative=config.simulationProject??'robot.sim.json';relativePath(relative);
    return path.join(root,relative);
  }
  async function doctor(resource){const root=workspace(resource);const report=await cli(['doctor','--project',await simulationProject(root)],root,process.platform==='win32'?120000:30000);output.appendLine(JSON.stringify(report,null,2));return report;}
  const views=simulationPanels(context,{cli,workspace,simulationProject,openScene:resource=>robots.open(resource),scenes});context.subscriptions.push({dispose:()=>views.closeAll()});
  async function startSimulation(resource){
    const root=workspace(resource);
    return tasks.start(root,async(record,assertOpen)=>{
      const executable=await ensureRuntime();trusted();record.executable=executable;
      record.project=await simulationProject(root);assertOpen();
      const folder=vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
      const task=new vscode.Task({type:'cadcove',project:record.project},folder,'Robot simulation','CadCove',new vscode.ProcessExecution(executable,['sim-run','--project',record.project],{cwd:root}),[]);
      task.presentationOptions={reveal:vscode.TaskRevealKind.Silent,panel:vscode.TaskPanelKind.Dedicated,clear:true};
      record.execution=await vscode.tasks.executeTask(task);
    });
  }
  async function playTeamWorkspace(resource){
    const root=workspace(resource),project=await simulationProject(root);
    const existing=await cli(['sim-state','--project',project],root);
    if(existing.ok&&!existing.result?.error&&existing.result?.state?.tick>=1)return views.open(resource);
    await startSimulation(resource);
    return vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'CadCove: Starting Amarillo practice'},async()=>{
      const until=Date.now()+60000;let last='Starting robot program';
      while(Date.now()<until){
        const state=await cli(['sim-state','--project',project],root);
        if(state.ok&&!state.result?.error&&state.result?.state?.tick>=1)return views.open(resource);
        last=state.error?.message??JSON.stringify(state.error??'Waiting for physics');
        await new Promise(resolve=>setTimeout(resolve,300));
      }
      throw Error('Team robot did not become ready: '+last+'. See the Robot simulation terminal.');
    });
  }
  async function createTeamExample(destination,{open=true}={}){
    trusted();
    if(!destination){
      const here=vscode.workspace.workspaceFolders?.length===1?vscode.workspace.workspaceFolders[0].uri:undefined;
      if(here){try{const p=JSON.parse(await fs.readFile(path.join(here.fsPath,'robot.sim.json'),'utf8'));if(p.id==='team3310-rebuilt')return playTeamWorkspace(here);}catch(error){if(error.code!=='ENOENT')throw error;}}
      const chosen=await vscode.window.showOpenDialog({title:'Choose parent folder for your team robot example',canSelectFolders:true,canSelectFiles:false,canSelectMany:false,defaultUri:vscode.Uri.file(path.join(os.homedir(),'Documents'))});if(!chosen)return;
      const name=await vscode.window.showInputBox({title:'Team robot workspace name',value:'CadCove-Amarillo',validateInput:n=>!n.trim()||n==='.'||n==='..'||/[\\/:]/.test(n)?'Enter a folder name':undefined});if(!name)return;
      destination=vscode.Uri.file(path.join(chosen[0].fsPath,name));
    }
    const root=destination.fsPath;
    const report=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'CadCove: Preparing team robot, field and controls'},()=>cli(['example-create','--workspace',root,'--example','team3310-rebuilt'],path.dirname(root),180000));
    if(!report.ok)throw Error(report.error?.message??'Team example creation failed');
    if(open){await context.globalState.update('cadcove.pendingTeamExample',root);await vscode.commands.executeCommand('vscode.openFolder',destination,{forceNewWindow:true});}
    return report;
  }
  async function stopSimulation(resource){
    const root=workspace(resource),record=tasks.records.get(root);
    const report=await cli(['sim-stop','--project',record?.project??await simulationProject(root)],root);
    output.appendLine(JSON.stringify(report,null,2));return report;
  }
  const mechanisms={
    async open(resource,options={}){const root=workspace(resource),config=await settings(root),state=await cad.openModel(vscode.Uri.file(path.join(root,config.sourceDirectory,config.entryPoint)));const until=Date.now()+120000;while(state.diagnostics.phase!=='ready'&&Date.now()<until){if(state.disposed||state.diagnostics.phase==='error')throw Error(state.diagnostics.error??'CAD scene unavailable');await new Promise(r=>setTimeout(r,50));}if(state.diagnostics.phase!=='ready')throw Error('CAD scene loading timed out');if(options.field)await state.requestView('field');return {ok:true,unifiedScene:true,entry:state.entry};},
    async request(resource,action,args={}){const root=workspace(resource),config=await settings(root);if(action==='command'){action=args.method;args=args.args??{};}else if(action==='place'&&args.position)args={...args,position:args.position.map(x=>x*1000)};const result=await cad.request(root,config.entryPoint,action,args);if(action==='capture'){const directory=path.join(root,config.buildDirectory,'mechanism-preview');await fs.mkdir(directory,{recursive:true});const image=path.join(directory,'preview.png');await fs.writeFile(image,Buffer.from(result.image.split(',')[1],'base64'));return {...result,image};}return result;},
    canvases:()=>[],closeAll(){}
  };
  context.subscriptions.push({dispose:()=>mechanisms.closeAll()});
  const robots=robotPanels(context,{workspace,simulationProject,cad,settings,scenes});
  context.subscriptions.push({dispose:()=>robots.closeAll()});
  const mcp=registerMcp(context,{workspace,simulationProject,robots,mechanisms,cad,cli,startSimulation,stopSimulation,playTeamWorkspace,output,ensureRuntime});
  context.subscriptions.push(vscode.tasks.onDidEndTask(event=>tasks.ended(event.execution)));
  stopOwnedSimulations=async()=>{
    await mcp.close();robots.closeAll();views.closeAll();mechanisms.closeAll();
    const closing=tasks.close();
    for(const c of cancellations)c.abort();
    await closing;
  };
  const command=(id,fn)=>context.subscriptions.push(vscode.commands.registerCommand(id,async(...args)=>{try{return await fn(...args);}catch(error){output.appendLine(String(error.stack||error));await vscode.window.showErrorMessage(error.message);}}));
  command('cadcove.simulation.buildCustom',async resource=>{
    const root=workspace(resource),projectFile=await simulationProject(root);
    const profile=JSON.parse(await fs.readFile(projectFile,'utf8'));
    if(!profile.runtime?.customSimulator){
      const choice=await vscode.window.showInformationMessage('This project uses the bundled simulator. Configure runtime.customSimulator to build team-owned Rust mechanisms.', 'Setup guide');
      if(choice)await vscode.env.openExternal(vscode.Uri.parse('https://github.com/gfleming1992/CadCove-FRC/blob/main/docs/CUSTOM-SIMULATOR.md'));
      return;
    }
    try{await execute('cargo',['--version'],{timeout:10000,windowsHide:true});}
    catch{
      const choice=await vscode.window.showWarningMessage('Building a custom simulator needs Rust/Cargo and your platform’s native build tools. Install them, then restart VS Code.', 'Install Rust');
      if(choice)await vscode.env.openExternal(vscode.Uri.parse('https://www.rust-lang.org/tools/install'));
      return;
    }
    const executable=await ensureRuntime();
    const task=new vscode.Task({type:'cadcove-custom-simulator'},vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root)),
      'Build custom simulator','CadCove',new vscode.ProcessExecution(executable,['sim-build','--project',projectFile],{cwd:root}),['$rustc']);
    task.presentationOptions={reveal:vscode.TaskRevealKind.Always};
    return vscode.tasks.executeTask(task);
  });
  command('cadcove.robot.open',robots.open);
  command('cadcove.mcp.start',async()=>{await mcp.start();return {ok:true};});
  command('cadcove.initialize',initialize);
  command('cadcove.example.play',createTeamExample);
  command('cadcove.guidance.update',updateGuidance);
  command('cadcove.runtime.repair',repairRuntime);
  command('cadcove.doctor',async resource=>{const report=await doctor(resource);output.show(true);return report;});
  command('cadcove.simulation.start',startSimulation);
  command('cadcove.simulation.stop',stopSimulation);
  command('cadcove.simulation.open',views.open);
  command('cadcove.simulation.capture',views.capture);
  command('cadcove.terminal',async resource=>{const root=workspace(resource),executable=await ensureRuntime();const terminal=vscode.window.createTerminal({name:'CadCove',cwd:root,env:{PATH:path.dirname(executable)+path.delimiter+(process.env.PATH||'')}});context.subscriptions.push(terminal);terminal.show();return terminal;});
  // Existing configured workspaces get their verified runtime on activation.
  // Initialization remains explicit so installing an extension doesn't edit code.
  if(vscode.workspace.isTrusted&&vscode.workspace.workspaceFolders?.length)void ensureRuntime().catch(error=>output.appendLine('Runtime installation: '+error.message+' — run CadCove: Repair Runtime from the Command Palette.'));
  const pending=context.globalState.get('cadcove.pendingTeamExample');
  if(vscode.workspace.isTrusted&&pending&&vscode.workspace.workspaceFolders?.some(f=>f.uri.fsPath===pending)){
    void context.globalState.update('cadcove.pendingTeamExample',undefined).then(()=>playTeamWorkspace(vscode.Uri.file(pending))).catch(error=>{output.appendLine(String(error.stack||error));void vscode.window.showErrorMessage('CadCove team example: '+error.message);});
  }
  return {...cad,modelMenuEntries:modelMenu.entries,openMechanismPreview:mechanisms.open,mechanismRequest:mechanisms.request,closeMechanismPreviews:mechanisms.closeAll,openRobotCAD:robots.open,robotDiagnostics:robots.diagnostics,startMcp:mcp.start,createTeamExample,playTeamWorkspace,ensureRuntime,repairRuntime,initializeWorkspace:initialize,doctor,projectSettings:settings,startSimulation,stopSimulation,openSimulation:views.open,simulationDiagnostics:views.diagnostics,closeSimulationViews:views.closeAll,captureSimulation:views.capture};
}
export async function deactivate(){deactivateCAD();await stopOwnedSimulations();}
