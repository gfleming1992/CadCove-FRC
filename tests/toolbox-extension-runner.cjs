const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async function(){
 const folder=vscode.workspace.workspaceFolders[0].uri.fsPath;
 const reportFile=path.join(folder,'extension-test-report.json');let api,mcpClient,simulationStarted=false;
 try{
  const extension=vscode.extensions.getExtension(process.env.CADCOVE_TEST_EXTENSION_ID??'gfleming1992.cadcove-toolbox');
  assert.ok(extension,'Packaged toolbox must be installed');
  const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
  const profile=process.env.CADCOVE_TEST_PROFILE;assert.ok(profile,'Use the isolated editor test launcher');
  assert.ok(samePath(path.dirname(path.dirname(extension.extensionPath)),profile),'Installed extension must come from the isolated profile');
  if(process.env.CADCOVE_PYTHON)assert.ok(samePath(vscode.workspace.getConfiguration('instantcad',vscode.Uri.file(folder)).get('pythonPath'),process.env.CADCOVE_PYTHON),'Editor must read the configured Python from the isolated profile');
  let companions;
  try{companions=JSON.parse(await fs.readFile(path.join(folder,'companion-expectations.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(companions){
   assert.equal(vscode.version,companions.editorVersion,'Test the WPILib installer editor version');
   for(const item of companions.extensions){const installed=vscode.extensions.getExtension(item.name);assert.ok(installed,'Missing '+item.name);assert.equal(installed.packageJSON.version,item.version);}
   const wpilib=vscode.extensions.getExtension('wpilibsuite.vscode-wpilib');
   await wpilib.activate();assert.equal(wpilib.isActive,true,'WPILib activates alongside CadCove');
  }
  const buildProvenance=JSON.parse(await fs.readFile(path.join(extension.extensionPath,'build-provenance.json'),'utf8'));
  api=await extension.activate();
  const init=await api.initializeWorkspace();assert.equal(init.ok,true);
  for(const file of ['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'])assert.match(await fs.readFile(path.join(folder,file),'utf8'),/\.cadcove\/AGENT\.md/);
  const instructions=await fs.readFile(path.join(folder,'AGENTS.md'),'utf8');assert.match(instructions,/\.cadcove\/AGENT.md/);
  assert.match(await fs.readFile(path.join(folder,'.cadcove/skills/references/cadquery-api.md'),'utf8'),/CadQuery 2.6.1/);
  let runtime=await api.ensureRuntime();await fs.access(runtime);
  assert.ok(!path.relative(path.join(profile,'user-data'),runtime).startsWith('..'),'Runtime storage must stay inside the isolated user-data directory');
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
  mcpClient=new Client({name:'installed-extension-test',version:'1'});
  await mcpClient.connect(new StdioClientTransport({command:runtime,args:['mcp','--workspace',folder]}));
  const toolList=(await mcpClient.listTools()).tools.map(t=>t.name);assert.ok(toolList.includes('open_robot_cad'));
  const mcpCall=async(name,args={})=>{const result=await mcpClient.callTool({name,arguments:args},undefined,{timeout:90000});assert.ok(!result.isError,JSON.stringify(result));return result;};
  assert.equal(JSON.parse((await mcpCall('workspace_context')).content[0].text).workspace,folder);
  const doctor=await api.doctor();assert.equal(doctor.ok,false);
  assert.equal(doctor.checks.find(c=>c.id==='native-engine').ok,true);
  const initialConfigFile=path.join(folder,'.cadcove/project.json'),initialConfig=JSON.parse(await fs.readFile(initialConfigFile,'utf8'));initialConfig.entryPoint='models.py';await fs.writeFile(initialConfigFile,JSON.stringify(initialConfig));
  const entry=path.join(folder,'cad/models.py');
  const code=`import cadquery as cq
def build(ctx):
    plate=cq.Workplane('XY').box(100,80,5,centered=False).edges().fillet(1).cut(cq.Workplane('XY').center(30,40).circle(4).extrude(9).translate((0,0,-2)))
    return [dict(id='base',name='Base',color='#dd4400',shape=plate),dict(id='upright',name='Upright',color='#4488ff',shape=cq.Workplane('XY').box(5,20,60,centered=False).translate((10,10,5)))]
`;

  await fs.writeFile(entry,code);
  const waitFor=async predicate=>{const until=Date.now()+60000;while(Date.now()<until){const state=api.getDiagnostics()[0];if(predicate(state))return state;await delay(100);}throw Error('Timed out: '+JSON.stringify(api.getDiagnostics()));};
  await api.openModel();
  const initial=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');
  assert.equal(initial.phase,'ready',JSON.stringify(initial));assert.equal(initial.parts,2);assert.equal(initial.source,'build');
  assert.equal(initial.sourceDirectory,path.join(folder,'cad'));
  assert.equal(initial.buildDirectory,path.join(folder,'build/cadcove/cad-cache'));
  const cache=path.join(initial.buildDirectory,'models.py');
  let status=JSON.parse(await fs.readFile(path.join(cache,'status.json'),'utf8'));
  assert.equal(status.ok,true);assert.equal(status.parts.length,2);
  const base=status.parts.find(p=>p.id==='base');
  assert.equal(base.color,'#dd4400');assert.equal(base.metrics.valid,true);
  assert.ok(base.metrics.volume>35000&&base.metrics.volume<40000,'Fillets and through-hole remove material from the plate');
  assert.ok(base.metrics.triangles>12,'Curved edges and hole are actually tessellated');
  assert.equal(status.runtime,buildProvenance.runtimeIdentity,'Scene feedback uses the installed kernel identity');
  assert.ok((await fs.stat(path.join(cache,'preview.png'))).size>1000);
  const query=async name=>JSON.parse((await execute(runtime,[name,'--workspace',folder])).stdout);
  assert.equal((await query('cad-status')).sourceRevision,initial.revision);
  const preview=await query('cad-preview');assert.equal(preview.ok,true);assert.equal(preview.acceptedRevision,initial.revision);assert.equal(preview.image,path.join(cache,'preview.png'));
  await fs.writeFile(entry,code.replace('100,80,5','140,80,5'));
  const edited=await waitFor(s=>s?.phase==='ready'&&s.revision!==initial.revision);
  assert.equal(edited.parts,2);
  await fs.writeFile(entry,'raise ValueError("intentional failed CAD edit")');
  const failed=await waitFor(s=>s?.phase==='error');assert.match(failed.error,/intentional failed CAD edit/);assert.equal(failed.revision,edited.revision);assert.equal(failed.parts,2);
  await fs.writeFile(entry,code.replace('100,80,5','140,80,5'));await waitFor(s=>s?.phase==='ready');
  assert.equal((await query('cad-status')).ok,true,'Restored source clears failed CLI feedback');
  api.closeAll();await delay(300);
  await fs.writeFile(path.join(cache,'status.json'),JSON.stringify({ok:false,revision:edited.revision,error:'stale prior error'}));
  await api.openModel();
  const cached=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');
  assert.equal(cached.phase,'ready',JSON.stringify(cached));assert.equal(cached.source,'disk-cache');assert.equal(cached.workerLoaded,false);
  assert.equal((await query('cad-status')).ok,true,'Validated cache clears stale CLI feedback without loading the worker');
  // Exercise the installed command while an old native process remains alive.
  // Damage only this isolated test profile's bridge bundle, never a user runtime.
  const oldRuntime=runtime,oldDirectory=path.dirname(runtime),bundle=path.join(oldDirectory,'bridge-sources.json');
  const damaged=Buffer.alloc((await fs.stat(bundle)).size);
  const native=spawn(path.join(oldDirectory,process.platform==='win32'?'instantcad-sim.exe':'instantcad-sim'),[],{stdio:['pipe','pipe','pipe']});
  const lines=[];let buffered='',nativeError;native.on('error',e=>nativeError=e);
  native.stdout.on('data',chunk=>{buffered+=chunk;let end;while((end=buffered.indexOf('\n'))>=0){lines.push(JSON.parse(buffered.slice(0,end)));buffered=buffered.slice(end+1);}});
  native.stderr.resume();
  const probe=async()=>{const count=lines.length;native.stdin.write('{"op":"capabilities"}\n');const until=Date.now()+5000;while(lines.length===count&&Date.now()<until&&!nativeError)await delay(20);if(nativeError)throw nativeError;assert.equal(lines[count]?.ok,true,'Existing native process still responds');};
  try{
    await probe();await fs.writeFile(bundle,damaged);
    const repaired=await vscode.commands.executeCommand('cadcove.runtime.repair');
    assert.equal(repaired?.ok,true);runtime=repaired.executable;assert.notEqual(runtime,oldRuntime);
    assert.deepEqual(await fs.readFile(bundle),damaged,'Repair must not rewrite existing generation');
    await probe();assert.equal(await api.ensureRuntime(),runtime);
    assert.equal((await query('cad-status')).ok,true,'New runtime executes against the same CAD workspace');
    const currentBundle=JSON.parse(await fs.readFile(path.join(path.dirname(runtime),'bridge-sources.json'),'utf8'));
    assert.equal(currentBundle.schema,1);
    assert.equal((await vscode.commands.executeCommand('cadcove.runtime.repair')).executable,runtime,'Healthy repeat repair reuses verified generation');
  }finally{native.stdin.end();if(native.exitCode===null)native.kill();}
  const report={ok:true,editorVersion:vscode.version,companions,wpilibActive:companions?true:undefined,extensionPath:extension.extensionPath,runtime,occt:buildProvenance.occt,runtimeIdentity:buildProvenance.runtimeIdentity,initialized:true,doctorFindsNative:true,initial,edited,cached,failedBuildPreservesScene:true,preview:true,actualInstalledVSIX:true,runtimeRepair:{command:true,oldRuntime,newRuntime:runtime,activeNativePreserved:true,healthyRepeatReused:true}};
  report.profileIsolation={verified:true,portableData:process.env.VSCODE_PORTABLE??null,pythonPath:vscode.workspace.getConfiguration('instantcad',vscode.Uri.file(folder)).get('pythonPath')};
  // Exercise the example shipped inside this installed runtime, not source
  // checkout fixtures. Its CAD must actually compile in the editor's kernel.
  const sample=path.join(folder,'exported-example');
  const exportedExample=JSON.parse((await execute(runtime,['example-create','--workspace',sample,'--example','training-robot'])).stdout);
  assert.equal(exportedExample.ok,true);assert.equal(exportedExample.robotBuildRequired,true);
  const projectConfig=path.join(folder,'.cadcove/project.json'),originalConfig=await fs.readFile(projectConfig,'utf8');
  api.closeAll();await delay(300);
  try{
    const config=JSON.parse(originalConfig);config.sourceDirectory='exported-example/cad';config.buildDirectory='exported-example/build/cadcove';
    await fs.writeFile(projectConfig,JSON.stringify(config));
    await api.openModel(vscode.Uri.file(path.join(sample,'cad/models.py')));
    const sampleState=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');
    assert.equal(sampleState.phase,'ready',JSON.stringify(sampleState));assert.equal(sampleState.parts,11);
    const sampleStatus=JSON.parse(await fs.readFile(path.join(sampleState.buildDirectory,'models.py/status.json'),'utf8'));
    assert.equal(sampleStatus.parts.find(p=>p.id==='bumper-front').color,'#cf303d');
    assert.ok(sampleStatus.parts.every(p=>p.metrics.valid));
    assert.equal((await query('cad-preview')).ok,true);
    report.exampleExport={fromInstalledRuntime:true,cadParts:sampleState.parts,colored:true,revision:sampleState.revision,robotBuildRequired:true};
  }finally{api.closeAll();await fs.writeFile(projectConfig,originalConfig);await delay(300);}
  let teamExample=false,simulationFixture=path.join(folder,'simulation-fixture.json');
  if(await fs.access(path.join(path.dirname(runtime),'team-example.cpack')).then(()=>true,()=>false)){
    const destination=path.join(folder,'amarillo');
    const created=await api.createTeamExample(vscode.Uri.file(destination),{open:false});
    assert.equal(created.example,'team3310-rebuilt');assert.equal(created.robotBuildRequired,false);
    const profile=JSON.parse(await fs.readFile(created.project,'utf8'));
    assert.equal(profile.runtime.controlSource,'driverstation');assert.equal(profile.runtime.driverStation,'gui');
    profile.runtime.controlSource='agent';delete profile.runtime.driverStation;
    for(const key of ['robot','field'])profile.cad[key]=path.resolve(destination,profile.cad[key]);
    for(const key of ['project','jar','nativeLibraries','assetRoot'])profile.runtime[key]=path.resolve(destination,profile.runtime[key]);
    profile.build=path.resolve(destination,profile.build);
    simulationFixture=path.join(destination,'simulation-fixture.json');
    await fs.writeFile(simulationFixture,JSON.stringify(profile));
    report.teamExample={createdByExtension:true,example:created.example,robotBuildRequired:false};teamExample=true;
    const teamConfig=JSON.parse(await fs.readFile(path.join(destination,'.cadcove/project.json'),'utf8'));
    assert.equal(teamConfig.entryPoint,'models.py','Packaged robot defaults to native Python');
    const savedConfig=await fs.readFile(projectConfig,'utf8');
    api.closeAll();await delay(200);
    try{
      const viewing={...teamConfig,sourceDirectory:'amarillo/'+teamConfig.sourceDirectory,buildDirectory:'amarillo/'+teamConfig.buildDirectory};
      await fs.writeFile(projectConfig,JSON.stringify(viewing));
      await api.openModel(vscode.Uri.file(path.join(destination,teamConfig.sourceDirectory,'models.py')));
      const nativeTeam=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');
      assert.equal(nativeTeam.phase,'ready',JSON.stringify(nativeTeam));assert.equal(nativeTeam.parts,1958);
      assert.equal(nativeTeam.source,'disk-cache');assert.equal(nativeTeam.workerLoaded,false);
      const capture=await mcpCall('cad_capture',{view:'iso'});assert.equal(capture.content[1].type,'image');
      const image=path.join(folder,'native-team.png');await fs.writeFile(image,Buffer.from(capture.content[1].data,'base64'));
      report.teamExample.nativeCad={parts:nativeTeam.parts,source:nativeTeam.source,workerLoaded:false,image,revision:nativeTeam.revision};
    }finally{api.closeAll();await fs.writeFile(projectConfig,savedConfig);await delay(200);}

  }
  if(await fs.access(simulationFixture).then(()=>true,()=>false)){
    const configFile=path.join(folder,'.cadcove/project.json'),config=JSON.parse(await fs.readFile(configFile,'utf8'));
    config.simulationProject=path.relative(folder,simulationFixture).split(path.sep).join('/');await fs.writeFile(configFile,JSON.stringify(config));
    const project=path.join(folder,config.simulationProject),manifest=JSON.parse(await fs.readFile(project,'utf8'));
    assert.equal((await api.doctor()).ok,true);
    await fs.rename(entry,entry+'.mcp-test-backup');
    try{
      const started=Date.now(),opened=JSON.parse((await mcpCall('open_robot_cad')).content[0].text);
      assert.equal(opened.kind,'imported-assembly');assert.equal(opened.phase,'ready');assert.ok(opened.instances>100);
      const openMilliseconds=Date.now()-started;
      const capture=await mcpCall('capture_scene',{scene:'cad',view:'iso'});assert.equal(capture.content[1].type,'image');assert.ok(capture.content[1].data.length>1000);
      await mcpCall('set_camera',{scene:'cad',view:'front'});
      report.mcp={stdio:true,tools:toolList,openMilliseconds,instances:opened.instances,capture:true,camera:true};
    }finally{await fs.rename(entry+'.mcp-test-backup',entry);}

    if(teamExample)await api.playTeamWorkspace();
    else assert.equal((await api.startSimulation()).status,'starting');
    simulationStarted=true;
    await assert.rejects(api.startSimulation(),/already has a simulation/);
    let state;const deadline=Date.now()+(process.platform==='win32'?180000:60000);
    while(Date.now()<deadline){
      try{state=JSON.parse((await execute(runtime,['sim-state','--project',project],{timeout:6000})).stdout).result;break;}catch{}
      await delay(200);
    }
    assert.ok(state?.runId,'Managed robot must become ready');assert.ok(!state.error,state.error);
    const packet=path.join(folder,'test-controls.json');await fs.writeFile(packet,JSON.stringify({mode:'teleop',controllers:[]}));
    // A single packet has a one-second safety lease. Keep sending controls
    // while observing state: cold Windows CLI startup can outlast that lease.
    let refreshing=true,refreshError,packets=0,after;
    const refresh=(async()=>{try{while(refreshing){await execute(runtime,['sim-controls','--project',project,'--input',packet]);packets++;await delay(100);}}catch(error){refreshError=error;}})();
    try{
      const until=Date.now()+20000;
      while(Date.now()<until){
        if(refreshError)throw refreshError;
        after=JSON.parse((await execute(runtime,['sim-state','--project',project])).stdout).result;
        if(after.controlMode==='teleop'&&after.state.tick>state.state.tick)break;
        await delay(100);
      }
    }finally{refreshing=false;await refresh;}
    if(refreshError)throw refreshError;
    assert.equal(after.runId,state.runId);assert.ok(after.state.tick>state.state.tick);assert.equal(after.controlMode,'teleop');
    await delay(1200);
    const expired=JSON.parse((await execute(runtime,['sim-state','--project',project])).stdout).result;
    assert.equal(expired.controlMode,'disabled','Controls safely expire when the sender stops');
    report.controlLease={packets,enabledWhileRefreshed:true,disabledAfterExpiry:true};
    if(teamExample){
      const start=after.state.bodies.chassis.position,startTime=after.state.time;
      let driven=after,distance=0,n=0;const driveDeadline=Date.now()+20000;
      // Wait for simulated time, not two wall-clock seconds while the editor
      // and cold vendor libraries compete with a release build for this CPU.
      while(Date.now()<driveDeadline&&driven.state.time-startTime<3&&distance<=.1){
        await fs.writeFile(packet,JSON.stringify({mode:'teleop',controllers:[{port:1,axes:[0,-.5,0,0,0,0],buttons:0,pov:-1},{port:0,axes:[0,0,0,0,0,0],buttons:n++<3?2:0,pov:-1}]}));
        await execute(runtime,['sim-controls','--project',project,'--input',packet]);await delay(100);
        driven=JSON.parse((await execute(runtime,['sim-state','--project',project])).stdout).result;
        const finish=driven.state.bodies.chassis.position;distance=Math.hypot(finish[0]-start[0],finish[1]-start[1]);
      }
      assert.ok(distance>.1,'Packaged robot responds to actual driver controls: '+JSON.stringify({distance,simSeconds:driven.state.time-startTime,ticks:driven.state.tick-after.state.tick,robot:driven.robot}));
      report.teamExample.driveDistanceMeters=distance;report.teamExample.robotState=driven.robot;
      await fs.writeFile(packet,JSON.stringify({mode:'disabled',controllers:[]}));await execute(runtime,['sim-controls','--project',project,'--input',packet]);
    }
    await api.openSimulation();
    const viewDeadline=Date.now()+60000;let view;
    while(Date.now()<viewDeadline){view=api.simulationDiagnostics()[0];if(view?.phase==='ready'||view?.phase==='error')break;await delay(100);}
    const rawCounts=await Promise.all(['robot','field'].map(async kind=>JSON.parse(await fs.readFile(path.join(path.resolve(folder,manifest.cad[kind]),'instances.json'),'utf8')).length));
    assert.equal(view?.phase,'ready',JSON.stringify(view));assert.ok(view.instances>=rawCounts[0]+rawCounts[1],'Every authored occurrence is represented (appearance may split surfaces)');assert.equal(view.runId,state.runId);
    const optionsFile=path.join(folder,'capture-options.json');await fs.writeFile(optionsFile,JSON.stringify({scope:'robot',view:'iso',width:640,height:480}));
    const capture=JSON.parse((await execute(runtime,['sim-capture','--project',project,'--options',optionsFile],{timeout:25000})).stdout);
    assert.equal(capture.ok,true);assert.equal(capture.runId,state.runId);assert.equal(capture.width,640);assert.equal(capture.height,480);assert.ok((await fs.stat(capture.image)).size>1000);
    const hash=require('node:crypto').createHash('sha256').update(await fs.readFile(capture.image)).digest('hex');assert.equal(capture.sha256,hash);
    const cameraOptions=path.join(folder,'view-options.json');await fs.writeFile(cameraOptions,JSON.stringify({view:'top',follow:false}));
    assert.equal(JSON.parse((await execute(runtime,['sim-view','--project',project,'--options',cameraOptions])).stdout).ok,true);
    const practiceOptions=path.join(folder,'practice-options.json');await fs.writeFile(practiceOptions,JSON.stringify({action:'start',input:'keyboard'}));
    await assert.rejects(execute(runtime,['sim-practice','--project',project,'--options',practiceOptions]),/Command failed/);
    await vscode.window.showTextDocument(vscode.Uri.file(entry),{viewColumn:vscode.ViewColumn.One});await delay(300);
    report.simulationView={...view,capture:{image:capture.image,sha256:capture.sha256,tick:capture.tick,width:capture.width,height:capture.height},cliCamera:true,viewOnly:true};
    api.closeSimulationViews();
    assert.equal((await api.stopSimulation()).ok,true);
    const lock=path.join(manifest.build,'.cadcove-session-lock'),until=Date.now()+15000;
    while(Date.now()<until&&await fs.access(lock).then(()=>true,()=>false))await delay(100);
    await assert.rejects(fs.access(lock));await assert.rejects(fs.access(path.join(manifest.build,'cadcove-session.json')));simulationStarted=false;
    report.simulation={launchedFromInstalledExtension:true,packagedCLI:true,runId:state.runId,tickBefore:state.state.tick,tickAfter:after.state.tick,controlMode:after.controlMode,cleanShutdown:true};
  }
  if(process.env.CADCOVE_PYTHON){
    api.closeAll();
    const project=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(project,'utf8');
    const config=JSON.parse(saved);config.entryPoint='native.py';
    const nativeEntry=path.join(folder,config.sourceDirectory,'native.py');
    const source=`import cadquery as cq\ndef build(ctx):\n    return [{'id':'native-part','color':'#e64b36','shape':ctx.component('part',lambda:cq.Workplane('XY').box(30,40,5))}]\n`;
    const preferences=vscode.workspace.getConfiguration('instantcad',vscode.workspace.workspaceFolders[0].uri);
    try{
      await preferences.update('pythonPath',process.env.CADCOVE_PYTHON,vscode.ConfigurationTarget.WorkspaceFolder);
      await fs.writeFile(nativeEntry,source);await fs.writeFile(project,JSON.stringify(config));
      await mcpCall('open_robot_cad');
      const first=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');assert.equal(first.phase,'ready',JSON.stringify(first));assert.equal(first.workerLoaded,true);
      assert.equal((await query('cad-status')).sourceRevision,first.revision);
      await fs.writeFile(nativeEntry,source.replace('30,40,5','35,40,5'));
      const edit=await waitFor(s=>s?.phase==='ready'&&s.revision!==first.revision);assert.deepEqual(edit.camera,first.camera);
      assert.equal((await query('cad-status')).sourceRevision,edit.revision);
      const capture=await mcpCall('cad_capture',{view:'front',ids:['native-part']});assert.equal(capture.content[1].type,'image');
      const captureMeta=JSON.parse(capture.content[0].text);assert.equal(captureMeta.revision,edit.revision);
      assert.deepEqual(api.getDiagnostics()[0].camera,edit.camera,'Focused capture preserves camera');
      api.closeAll();await delay(200);
      await preferences.update('pythonPath','/nonexistent/python',vscode.ConfigurationTarget.WorkspaceFolder);
      await mcpCall('open_robot_cad');
      const cachedNative=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');
      // A queued source/configuration watcher can report "unchanged" after the
      // disk-cache ready event. Verify the cache outcome, not the last event label:
      // the accepted revision/geometry reopened with an unusable interpreter.
      assert.equal(cachedNative.phase,'ready',JSON.stringify(cachedNative));
      assert.ok(['disk-cache','unchanged'].includes(cachedNative.source),JSON.stringify(cachedNative));
      assert.equal(cachedNative.revision,edit.revision);assert.equal(cachedNative.parts,edit.parts);
      assert.ok(cachedNative.gpuBytes>0);assert.equal(cachedNative.workerLoaded,false);
      report.nativeCad={first,edit,cached:cachedNative,mcpOpen:true,mcpCapture:true,packagedCliFeedback:true,cameraPreserved:true};
    }finally{api.closeAll();await fs.writeFile(project,saved);}
  }
  await fs.writeFile(reportFile,JSON.stringify(report,null,2));api.closeAll();
 }catch(error){if(simulationStarted){await api?.stopSimulation().catch(()=>{});await delay(1500);simulationStarted=false;}await fs.writeFile(reportFile,JSON.stringify({ok:false,error:String(error.stack),stdout:error.stdout,diagnostics:api?.getDiagnostics()},null,2));api?.closeAll();throw error;}
 finally{await mcpClient?.close();if(simulationStarted)await api?.stopSimulation().catch(()=>{});}
};
