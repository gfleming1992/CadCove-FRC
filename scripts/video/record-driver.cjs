// Uses the official VS Code extension-test API and production CadCove commands.
const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
 const out=process.env.CADCOVE_RECORD_OUT,workspace=vscode.workspace.workspaceFolders[0].uri.fsPath;
 const report={ok:false,editorVersion:vscode.version,renderer:'SwiftShader software WebGPU',source:'Published-source Team 3310 native CadQuery components',installation:'Previously qualified Linux VSIX; installed through real VS Code API',markers:[],parts:[]};
 const log=await fs.open(path.join(out,'ffmpeg.log'),'w');
 const start=Date.now();const mark=(event,data={})=>{const item={event,seconds:(Date.now()-start)/1000,...data};report.markers.push(item);console.log(JSON.stringify(item));};
 const recorder=spawn('ffmpeg',['-y','-hide_banner','-f','x11grab','-video_size','1920x1080','-framerate','30','-i',process.env.DISPLAY,'-c:v','libx264','-preset','ultrafast','-crf','20','-threads','2','-pix_fmt','yuv420p',path.join(out,'vscode-raw.mp4')],{stdio:['pipe',log.fd,log.fd]});
 let recorderError;recorder.on('error',e=>recorderError=e);
 try{
  await delay(2000);mark('recording-start');
  await vscode.commands.executeCommand('workbench.extensions.search','@id:gfleming1992.cadcove-toolbox');await delay(3500);mark('extension-search');
  await vscode.commands.executeCommand('workbench.extensions.installExtension',vscode.Uri.file(process.env.CADCOVE_RECORD_VSIX));
  let extension;for(let n=0;n<100;n++){extension=vscode.extensions.getExtension('gfleming1992.cadcove-toolbox');if(extension)break;await delay(200);}
  assert.ok(extension,'Installed extension must be visible');report.extensionVersion=extension.packageJSON.version;mark('installed',{version:report.extensionVersion});
  await vscode.commands.executeCommand('extension.open','gfleming1992.cadcove-toolbox');await delay(6000);
  const api=await extension.activate();await api.ensureRuntime();
  await vscode.commands.executeCommand('workbench.view.explorer');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const entries=[
   ['Corner block','native/parts/p_left_front_corner_block_a8312ccb6369.py'],
   ['Backlash adjuster','native/parts/p_backlash_remover_left_side_c70badece837.py'],
   ['Curved rail','native/parts/p_bhr_2026_600_004a_fdc0673fe431.py']
  ];
  for(const [name,entry] of entries){
   const uri=vscode.Uri.file(path.join(workspace,'cad-assets/robot',entry));
   await vscode.window.showTextDocument(uri,{preview:false});await vscode.commands.executeCommand('revealInExplorer',uri);mark('source-visible',{name,entry});await delay(4500);
   mark('open-request',{name});await vscode.commands.executeCommand('cadcove.open',uri);
   let state;const deadline=Date.now()+120000;
   while(Date.now()<deadline){state=api.getDiagnostics().find(s=>s.entry===entry);if(state?.phase==='ready'||state?.phase==='error')break;await delay(200);}
   assert.equal(state?.phase,'ready',JSON.stringify(state));assert.ok(state.parts>0);
   mark('canvas-ready',{name,parts:state.parts});await delay(6000);
   const image=await api.request(workspace,entry,'capture',{view:'iso',width:1280,height:960});
   assert.ok(image.image?.startsWith('data:image/png;base64,'));await fs.writeFile(path.join(out,`${report.parts.length+1}-component.png`),Buffer.from(image.image.split(',')[1],'base64'));
   const status=JSON.parse(await fs.readFile(path.join(state.buildDirectory,entry,'status.json'),'utf8'));
   assert.ok(status.parts.every(p=>p.metrics.valid),'Native OCCT validation');
   report.parts.push({name,entry,state,valid:true});mark('capture-verified',{name});await delay(3000);
  }
  report.ok=true;mark('finished');await delay(2000);
 }catch(error){report.error=String(error.stack??error);mark('failure',{error:report.error});await delay(3000);}
 finally{
  if(recorderError){report.ok=false;report.recordingError=String(recorderError);}
  recorder.stdin?.write('q');await Promise.race([new Promise(r=>recorder.on('exit',r)),delay(8000)]);
  if(recorder.exitCode===null)recorder.kill('SIGINT');await log.close();
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 }
 assert.equal(report.ok,true,report.error??report.recordingError); 
};
