import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {NativeCadClient,nativeIdentityFor,resolveNativePython} from '../../../src/native/client.js';
import {snapshot} from '../../../src/core/revision.js';
import {readSources,inside,relativePath,projectLayout,cacheFile,commitNativeScene} from './project-files.js';
import {isStepFile,stepEntry,readStepSource} from './step-source.js';
const panels=new Map();
let output;
export function activate(context,options={}) {
  const commandPrefix=options.commandPrefix??'instantcad';
  output=vscode.window.createOutputChannel(options.outputName??'InstantCAD');context.subscriptions.push(output);
  const open=async(resource)=>{
    if(!vscode.workspace.isTrusted)throw Error('Trust this workspace before executing CAD source code.');
    const active=vscode.window.activeTextEditor?.document.uri;
    let workspace=vscode.workspace.getWorkspaceFolder(resource??active??vscode.Uri.file('/'));
    if(!workspace&&vscode.workspace.workspaceFolders?.length===1)workspace=vscode.workspace.workspaceFolders[0];
    if(!workspace&&!resource&&vscode.workspace.workspaceFolders?.length>1){
      const choice=await vscode.window.showWorkspaceFolderPick();if(!choice)return;workspace=choice;
    }
    const configuration=workspace?vscode.workspace.getConfiguration('instantcad',workspace.uri):undefined;
    let layout,projectSettings;
    if(workspace){
      if(workspace.uri.scheme!=='file')throw Error('InstantCAD currently requires a local filesystem workspace.');
      projectSettings=options.projectSettings?await options.projectSettings(workspace.uri.fsPath):undefined;
      layout=await projectLayout(workspace.uri.fsPath,projectSettings??(configuration?{
        sourceDirectory:configuration.get('sourceDirectory'),buildDirectory:configuration.get('buildDirectory'),entryPoint:configuration.get('entryPoint'),
      }:{}));
    }
    if(!resource&&active?.scheme==='file'&&(/\.py$/.test(active.fsPath)||isStepFile(active.fsPath))&&(!layout||active.fsPath.startsWith(layout.sourceRoot+path.sep)))resource=active;
    if(!resource&&layout)resource=vscode.Uri.file(path.join(layout.sourceRoot,layout.entryPoint));
    if(!resource){const selected=await vscode.window.showOpenDialog({canSelectMany:false,filters:{'CAD models':['py','step','stp']}});resource=selected?.[0];}
    if(!resource)return;
    const step=isStepFile(resource.fsPath);
    if(resource.scheme!=='file'||(!resource.fsPath.endsWith('.py')&&!step))throw Error('Choose a local Python, STEP or STP model.');
    const existing=panels.get(resource.toString());if(existing){existing.panel.reveal(vscode.ViewColumn.Active);return existing;}
    layout??=await projectLayout(path.dirname(resource.fsPath));
    // Imported assets may also live outside the configured CAD folder.
    if(step&&!resource.fsPath.startsWith(layout.sourceRoot+path.sep)){
      if(resource.fsPath.startsWith(layout.workspaceRoot+path.sep))layout={...layout,sourceRoot:layout.workspaceRoot};
      else layout=await projectLayout(path.dirname(resource.fsPath));
    }
    const root=layout.sourceRoot;
    const relative=path.relative(root,resource.fsPath).split(path.sep).join('/');
    await inside(root,relative);
    const entry=step?stepEntry(relative):relative;
    const sources=()=>step?readStepSource(root,relative):readSources(root,layout.buildRoot);
    const panel=vscode.window.createWebviewPanel(options.viewType??'instantcad.model',`CAD · ${path.basename(resource.fsPath)}`,vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'media'),vscode.Uri.file(root),...(layout.buildRoot?[vscode.Uri.file(layout.buildRoot)]:[])]});
    const state={panel,resource,root,entry,layout,diagnostics:{phase:'opening'},pending:new Map(),writes:new Map(),disposed:false};
    panels.set(resource.toString(),state);
    const assetUri=file=>panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
    const media=path.join(context.extensionPath,'media');
    const manifest=JSON.parse(await fs.readFile(path.join(media,'manifest.json'),'utf8'));
    const nativeRuntimeIdentity=nativeIdentityFor(path.join(media,'native','worker.py'));
    const config={runtime:nativeRuntimeIdentity,entry,project:path.basename(root),minimalUI:!!options.minimalUI};
    const nativeClient=new NativeCadClient({python:resolveNativePython({explicit:options.pythonPath,environment:process.env.CADCOVE_PYTHON,project:projectSettings?.pythonPath,editor:configuration?.get('pythonPath'),root:layout.workspaceRoot}),worker:path.join(media,'native','worker.py'),onLog:text=>output.appendLine(text)});
    let nativeArtifact,nativeArtifactRevision;
    const cleanup=async(token)=>{const write=state.writes.get(token);if(write){state.writes.delete(token);await write.handle.close().catch(()=>{});await fs.unlink(write.tmp).catch(()=>{});}};
    async function handle(method,args) {
      if(!vscode.workspace.isTrusted||state.disposed)throw Error('CAD project access is unavailable');
      switch(method){
        case 'sources':return sources();
        case 'native-build':{
          if(!nativeClient)throw Error('This is not a native CAD model');
          const source=await snapshot(await sources(),entry,nativeRuntimeIdentity);
          if(source.revision!==args.revision)throw Error('Source changed before native build');
          const file=await cacheFile(layout,entry,'profile.json',{create:true});
          const binary=path.join(path.dirname(file),'native-scene.bin');
          nativeArtifact=binary;nativeArtifactRevision=undefined;
          await fs.mkdir(path.dirname(binary),{recursive:true});
          const result=await nativeClient.request({kind:'build',root,entry,stepAsset:step?relative:undefined,files:source.files,revision:source.revision,output:binary});
          if((await snapshot(await sources(),entry,nativeRuntimeIdentity)).revision!==source.revision)throw Error('Source changed during native build');
          nativeArtifactRevision=source.revision;
          return {...result,url:assetUri(binary)};
        }
        case 'native-commit':{
          if(!nativeArtifact||nativeArtifactRevision!==args.revision)throw Error('No native artifact for this revision');
          if((await snapshot(await sources(),entry,nativeRuntimeIdentity)).revision!==args.revision)throw Error('Source changed before cache commit');
          const result=await commitNativeScene(layout,entry,nativeArtifact,args.revision,nativeRuntimeIdentity);
          nativeArtifact=undefined;nativeArtifactRevision=undefined;return result;
        }
        case 'native-inspect':if(!nativeClient)throw Error('Not a native model');return nativeClient.request({kind:'inspect',code:args.code});
        case 'native-cancel':nativeClient?.dispose();return true;
        case 'cache':{
          try{
            const meta=await cacheFile(layout,entry,'scene.json');
            const metadata=JSON.parse(await fs.readFile(meta,'utf8'));
            const binary=await cacheFile(layout,entry,'scene.bin');
            let feedbackSucceeded=false;
            try{const feedback=JSON.parse(await fs.readFile(await cacheFile(layout,entry,'status.json'),'utf8'));feedbackSucceeded=feedback.ok===true&&feedback.revision===metadata.revision;}catch{}
            return {...metadata,url:assetUri(binary),feedbackSucceeded};
          }catch{return null;}
        }
        case 'write-start':{
          if(state.writes.size>=4)throw Error('Too many cache writes');
          if(!Number.isSafeInteger(args.size)||args.size<0||args.size>512*1024*1024)throw Error('Cache artifact exceeds 512 MB');
          const target=await cacheFile(layout,entry,args.name,{create:true});
          await fs.mkdir(path.dirname(target),{recursive:true});
          await cacheFile(layout,entry,args.name,{create:true});
          const token=randomBytes(16).toString('hex'),tmp=target+'.'+token+'.tmp';
          const file=await fs.open(tmp,'wx');state.writes.set(token,{handle:file,tmp,target,size:args.size,offset:0});return token;
        }
        case 'write-chunk':{
          const write=state.writes.get(args.token);
          if(!write||args.offset!==write.offset||typeof args.base64!=='string'||args.base64.length>262144)throw Error('Invalid cache write chunk');
          const bytes=Buffer.from(args.base64,'base64');
          if(write.offset+bytes.length>write.size)throw Error('Cache write exceeds declared size');
          let offset=0;while(offset<bytes.length){const result=await write.handle.write(bytes,offset,bytes.length-offset,write.offset+offset);if(!result.bytesWritten)throw Error('Cache write made no progress');offset+=result.bytesWritten;}
          write.offset+=bytes.length;return true;
        }
        case 'write-end':{
          const write=state.writes.get(args.token);if(!write||write.offset!==write.size)throw Error('Incomplete cache artifact');
          await write.handle.close();await fs.rename(write.tmp,write.target);state.writes.delete(args.token);
          if(nativeArtifact&&path.basename(write.target)==='scene.bin'){await fs.unlink(nativeArtifact).catch(()=>{});nativeArtifact=undefined;}
          return true;
        }
        case 'write-abort':await cleanup(args.token);return true;
        case 'reveal':await vscode.window.showTextDocument(resource,{viewColumn:panel.viewColumn??vscode.ViewColumn.Active});return true;
        case 'report':{
          if(!args.state||JSON.stringify(args.state).length>16000)throw Error('Invalid diagnostics');
          state.diagnostics={...args.state,sourceDirectory:root,buildDirectory:layout.buildRoot??path.dirname(await cacheFile(layout,entry,'scene.bin',{create:true}))};output.appendLine(JSON.stringify({entry,...state.diagnostics}));return true;
        }
        default:throw Error('Unknown CAD host request');
      }
    }
    // Serial host requests also make chunk writes ordered and cancellation safe.
    let queue=Promise.resolve();
    const messages=panel.webview.onDidReceiveMessage(message=>{
      if(message?.agentReply){const task=state.pending.get(message.agentReply);if(task){clearTimeout(task.timer);state.pending.delete(message.agentReply);message.error?task.reject(Error(message.error)):task.resolve(message.result);}return;}
      if(message?.method==='native-cancel'){nativeClient?.dispose();void panel.webview.postMessage({id:message.id,result:true});return;}
      queue=queue.then(async()=>{
        if(!Number.isSafeInteger(message?.id)||typeof message.method!=='string')return;
        try{const result=await handle(message.method,message.args??{});await panel.webview.postMessage({id:message.id,result});}
        catch(error){await panel.webview.postMessage({id:message.id,error:error.message});}
      }).catch(error=>output.appendLine(String(error)));
    });
    const watcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root),'**/*'));
    let debounce;
    const changed=uri=>{
      if(step){if(uri.fsPath!==resource.fsPath)return;clearTimeout(debounce);debounce=setTimeout(()=>panel.webview.postMessage({event:'source-changed'}),200);return;}
      if(layout.buildRoot&&(uri.fsPath===layout.buildRoot||uri.fsPath.startsWith(layout.buildRoot+path.sep)))return;
      const relative=path.relative(root,uri.fsPath).split(path.sep);
      if(relative.some(segment=>segment.startsWith('.')||['node_modules','dist','__pycache__'].includes(segment)))return;
      if(!/\.(py|json|step|stp|brep)$/i.test(uri.fsPath))return;
      clearTimeout(debounce);debounce=setTimeout(()=>panel.webview.postMessage({event:'source-changed'}),200);
    };
    watcher.onDidChange(changed);watcher.onDidCreate(changed);watcher.onDidDelete(changed);
    // Source and generated artifacts have separate watchers: a CLI build may
    // finish after an editor failure without changing the source a second time.
    const cacheMeta=await cacheFile(layout,entry,'scene.json',{create:true});
    const cacheWatcher=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(cacheMeta)),'scene.json'));
    const cacheChanged=()=>{clearTimeout(debounce);debounce=setTimeout(()=>panel.webview.postMessage({event:'source-changed'}),200);};
    cacheWatcher.onDidChange(cacheChanged);cacheWatcher.onDidCreate(cacheChanged);

    const configurationListener=vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('instantcad',workspace?.uri)){void panel.webview.postMessage({event:'configuration-changed'});}});
    panel.onDidDispose(()=>{for(const task of state.pending.values()){clearTimeout(task.timer);task.reject(Error('CAD panel closed'));}state.pending.clear();nativeClient?.dispose();if(nativeArtifact)void fs.unlink(nativeArtifact).catch(()=>{});configurationListener.dispose();state.disposed=true;clearTimeout(debounce);watcher.dispose();cacheWatcher.dispose();messages.dispose();for(const token of state.writes.keys())void cleanup(token);panels.delete(resource.toString());});
    panel.onDidChangeViewState(()=>{if(panel.visible)void panel.webview.postMessage({event:'source-changed'});});
    const nonce=randomBytes(16).toString('base64');
    const csp=`default-src 'none'; img-src ${panel.webview.cspSource} data: blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${panel.webview.cspSource}; connect-src ${panel.webview.cspSource};`;
    let html=await fs.readFile(path.join(media,'index.html'),'utf8');
    html=html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`).replace('<style>',`<style nonce="${nonce}">`);
    html=html.replace(/<script>[\s\S]*?<\/script>/,`<script nonce="${nonce}">globalThis.INSTANTCAD_HOST=${JSON.stringify(config).replace(/</g,'\\u003c')};</script>`);
    html=html.replace(/<script type="module" src="[^"]+"><\/script>/,`<script nonce="${nonce}" src="${assetUri(path.join(media,manifest.main))}"></script>`);
    panel.webview.html=html;
    return state;
  };
  context.subscriptions.push(vscode.commands.registerCommand(commandPrefix+'.open',resource=>open(resource).catch(error=>vscode.window.showErrorMessage(error.message))));
  context.subscriptions.push(vscode.commands.registerCommand(commandPrefix+'.diagnostics',()=>output.show()));
  return {openModel:open,async request(workspace,entry,method,args={}){
    const state=[...panels.values()].find(p=>p.layout.workspaceRoot===workspace&&p.entry===entry);
    if(!state)throw Error('Open this model with VS Code: right-click → Open in CAD Canvas');
    return new Promise((resolve,reject)=>{const id=randomBytes(16).toString('hex'),timer=setTimeout(()=>{state.pending.delete(id);reject(Error('CAD capture timed out'));},60000);state.pending.set(id,{resolve,reject,timer});void state.panel.webview.postMessage({agentRequest:id,method,args});});
  },getDiagnostics:()=>[...panels.values()].map(p=>({entry:p.entry,...p.diagnostics})),closeAll:()=>{for(const p of panels.values())p.panel.dispose();}};
}
export function deactivate(){for(const p of panels.values())p.panel.dispose();}
