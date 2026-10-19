const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process');const execute=require('node:util').promisify(execFile);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
 const out=process.env.CADCOVE_RECORD_OUT,workspace=vscode.workspace.workspaceFolders[0].uri.fsPath,mode=process.env.CADCOVE_RECORD_MODE;
 const report={ok:false,mode,markers:[],evidence:[],renderer:'SwiftShader; functional capture, not a GPU performance benchmark',automation:'Real production extension and CLI; agent-authored edit executed by the recording driver. No staged agent chat.'};
 const start=Date.now();const mark=(event,data={})=>{report.markers.push({event,seconds:(Date.now()-start)/1000,...data});console.log(event);};
 const log=await fs.open(path.join(out,'ffmpeg.log'),'w');
 const recorder=spawn('ffmpeg',['-y','-hide_banner','-f','x11grab','-video_size','1920x1080','-framerate','30','-i',process.env.DISPLAY,'-c:v','libx264','-preset','ultrafast','-crf','20','-threads','2','-pix_fmt','yuv420p',path.join(out,'vscode-raw.mp4')],{stdio:['pipe',log.fd,log.fd]});
 let api,cli,simProject;
 const mouse=async(...args)=>execute('xdotool',args.map(String),{timeout:15000});
 const drag=async(button,dx,dy,steps=40)=>{await mouse('mousemove',1050,500,'mousedown',button);try{for(let n=1;n<=steps;n++){await mouse('mousemove',Math.round(1050+dx*n/steps),Math.round(500+dy*n/steps));await delay(32);}}finally{await mouse('mouseup',button);}};
 const tour=async()=>{await drag(1,170,35,40);await delay(250);await drag(3,100,-35,26);await delay(250);await mouse('click','--repeat',3,'--delay',140,4);await delay(250);await drag(1,-120,-20,36);await delay(300);};
 const show=async file=>{const uri=vscode.Uri.file(file);await vscode.window.showTextDocument(uri,{preview:false});await vscode.commands.executeCommand('revealInExplorer',uri);};
 const command=async(args)=>{const {stdout}=await execute(cli,args,{cwd:workspace,env:process.env,timeout:180000,maxBuffer:4e6});return JSON.parse(stdout);};
 try{
  await vscode.commands.executeCommand('workbench.extensions.installExtension',vscode.Uri.file(process.env.CADCOVE_RECORD_VSIX));
  let ext;for(let i=0;i<100;i++){ext=vscode.extensions.getExtension('gfleming1992.cadcove-toolbox');if(ext)break;await delay(200);}assert.ok(ext);api=await ext.activate();cli=await api.ensureRuntime();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');await vscode.commands.executeCommand('workbench.action.closeSidebar');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  mark('ready',{version:ext.packageJSON.version});
  if(mode==='edit'){
   const entry='native/parts/p_left_front_corner_block_a8312ccb6369.py',file=path.join(workspace,'cad-assets/robot',entry),old=await fs.readFile(file,'utf8');
   const prompt=path.join(workspace,'EDIT-REQUEST.md');await fs.writeFile(prompt,'# Ask your coding agent\n\nRead the CadCove workspace instructions.\n\nChange this corner block’s main bore to 12 mm.\nKeep the outer shape and part ID unchanged.\n\nBuild it, check the exact bore and solid validity,\nthen capture the result for review.\n\nThis tutorial edits a copy of Team 3310’s part.\nIt is not a manufacturing approval.\n');
   await show(prompt);mark('prompt');await delay(7000);
   await show(file);mark('source-before');await delay(5000);
   await vscode.commands.executeCommand('cadcove.open',vscode.Uri.file(file));
   async function ready(previous){let state;const end=Date.now()+120000;while(Date.now()<end){state=api.getDiagnostics().find(s=>s.entry===entry);if(state?.phase==='error')throw Error(JSON.stringify(state));if(state?.phase==='ready'&&(!previous||state.revision!==previous))return state;await delay(300);}throw Error('CAD not ready '+JSON.stringify(state));}
   const before=await ready();report.before=before;mark('before-ready');
   const first=await api.request(workspace,entry,'capture',{view:'iso',width:1280,height:960});await fs.writeFile(path.join(out,'before.png'),Buffer.from(first.image.split(',')[1],'base64'));await vscode.commands.executeCommand('workbench.action.closeSidebar');mark('opening-orbit');await drag(1,85,18,38);await drag(1,-85,-18,38);await delay(1000);
   const baseline=path.join(workspace,'corner-before.py');await fs.writeFile(baseline,old);
   const updated=old.replace("'holeScale': 1,", "'holeScale': 12 / 9.652,  # 12 mm bore; preserve stock and mounting features\n    ");assert.notEqual(updated,old);
   await fs.writeFile(file,updated);mark('edit-saved');
   await vscode.commands.executeCommand('vscode.diff',vscode.Uri.file(baseline),vscode.Uri.file(file),'AI edit: 12 mm bore');await vscode.commands.executeCommand('workbench.action.closeSidebar');await delay(8000);mark('diff');
   await vscode.commands.executeCommand('cadcove.open',vscode.Uri.file(file));await delay(4000);const after=await ready();report.after=after;
   const checks=path.join(workspace,'checks.py');await fs.writeFile(checks,"shape = parts[0]['shape']\nradii = [e.radius() for e in shape.Edges() if e.geomType() == 'CIRCLE']\nassert shape.isValid(), 'OCCT invalid solid'\nassert len(shape.Solids()) == 1, 'Expected one solid'\nassert any(abs(r - 6.0) < 1e-5 for r in radii), '12 mm bore missing'\nresult = {'valid': True, 'solids': 1, 'boreDiameterMm': 12, 'volumeMm3': shape.Volume()}\n");
   const inputs=path.join(workspace,'checks.jsonl');await fs.writeFile(inputs,JSON.stringify({op:'build'})+'\n'+JSON.stringify({op:'inspect',code:await fs.readFile(checks,'utf8')})+'\n');
   const check=await new Promise((resolve,reject)=>{const child=spawn(cli,['cad-session','--workspace',workspace,'--entry',entry],{cwd:workspace,env:process.env});let stdout='',stderr='';child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);child.on('error',reject);child.on('exit',code=>{try{const lines=stdout.trim().split('\n').map(JSON.parse);if(code||lines.some(x=>!x.ok))throw Error(stderr+' '+stdout);resolve(lines.at(-1));}catch(e){reject(e);}});fs.readFile(inputs).then(bytes=>child.stdin.end(bytes));});assert.ok(check.ok);report.evidence.push(check);mark('validated');
   const terminal=vscode.window.createTerminal({name:'CadCove geometry checks',cwd:workspace});terminal.show();terminal.sendText(`"${cli}" cad-session --workspace . --entry ${entry} < checks.jsonl`);await delay(22000);mark('terminal-check');
   await vscode.commands.executeCommand('workbench.action.closePanel');await vscode.commands.executeCommand('cadcove.open',vscode.Uri.file(file));
   const capture=await api.request(workspace,entry,'capture',{view:'iso',width:1280,height:960});await fs.writeFile(path.join(out,'after.png'),Buffer.from(capture.image.split(',')[1],'base64'));mark('after-ready');await vscode.commands.executeCommand('workbench.action.closeSidebar');mark('orbit-pan-zoom');await tour();await delay(2500);
   report.entry=entry;
  }else{
   simProject=path.join(workspace,'robot.sim.json');const profile=JSON.parse(await fs.readFile(simProject));
   // Headless cloud has no physical USB controller. Use explicit agent ownership.
   profile.runtime.controlSource='agent';delete profile.runtime.driverStation;await fs.writeFile(simProject,JSON.stringify(profile,null,2));
   report.controlSource='Leased virtual Xbox input through actual WPILib/Phoenix robot code; no physical USB controller on cloud runner';
   const check=await command(['sim-validate','--project',simProject]);assert.ok(check.ok);report.evidence.push(check);
   await show(simProject);mark('profile');await delay(5000);
   await api.startSimulation(vscode.Uri.file(simProject));mark('start-request');
   let state;const end=Date.now()+120000;while(Date.now()<end){try{state=(await command(['sim-state','--project',simProject])).result;if(state?.state?.tick>1&&!state.error)break;}catch{}await delay(500);}assert.ok(state?.state?.tick>1);mark('runtime-ready');
   await vscode.commands.executeCommand('workbench.action.closeAllEditors');await api.openSimulation(vscode.Uri.file(simProject));const commands=await vscode.commands.getCommands(true);if(commands.includes('workbench.action.joinAllGroups'))await vscode.commands.executeCommand('workbench.action.joinAllGroups');await vscode.commands.executeCommand('workbench.action.closeSidebar');await vscode.commands.executeCommand('workbench.action.closePanel');
   let viewReady=false;const ve=Date.now()+240000;while(Date.now()<ve){const diag=api.simulationDiagnostics();if(diag.some(d=>d.phase==='ready')){viewReady=true;report.viewer=diag;break;}if(diag.some(d=>d.phase==='error'))throw Error(JSON.stringify(diag));await delay(500);}assert.ok(viewReady,'Simulation viewer did not become ready: '+JSON.stringify(api.simulationDiagnostics()));mark('view-ready');await delay(6000);
   const initial=(await command(['sim-state','--project',simProject])).result;const request=path.join(workspace,'controls.json');
   for(let i=0;i<40;i++){await fs.writeFile(request,JSON.stringify({mode:'teleop',controllers:[{port:1,axes:[0,-.45,0,0,i>20?.15:0,0],buttons:0,pov:-1}]}));await command(['sim-controls','--project',simProject,'--input',request]);await delay(150);}
   await fs.writeFile(request,JSON.stringify({mode:'disabled',controllers:[]}));await command(['sim-controls','--project',simProject,'--input',request]);
   const final=(await command(['sim-state','--project',simProject])).result;report.motion={before:initial.state.bodies.chassis.position,after:final.state.bodies.chassis.position,ticks:final.state.tick-initial.state.tick};assert.ok(report.motion.ticks>0);mark('driving-finished');
   const capture=await api.captureSimulation(vscode.Uri.file(simProject));await fs.copyFile(capture.image,path.join(out,'simulation.png'));mark('capture');await delay(6000);
   api.closeSimulationViews();await vscode.commands.executeCommand('workbench.action.closeAllEditors');
   const terminal=vscode.window.createTerminal({name:'Headless simulation telemetry',cwd:workspace});terminal.show();terminal.sendText(`"${cli}" sim-state --project robot.sim.json`);mark('headless-state');await delay(7000);
   terminal.sendText(`"${cli}" sim-stop --project robot.sim.json`);await delay(5000);mark('stopped');
   report.profile='gameplay';report.detailedRun=false;
  }
  report.ok=true;mark('finished');
 }catch(e){report.error=String(e.stack??e);mark('failed');await delay(2000);}
 finally{
  if(simProject&&cli)await command(['sim-stop','--project',simProject]).catch(()=>{});
  recorder.stdin.write('q');await Promise.race([new Promise(r=>recorder.on('exit',r)),delay(8000)]);if(recorder.exitCode===null)recorder.kill();await log.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 }
 assert.ok(report.ok,report.error);
};
