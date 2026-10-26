const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Native startup and browser animation frames are asynchronous on CI hosts.
// Wait for the asserted state, with a bounded deadline and last-state diagnostics.
async function waitState(read,predicate,timeout=10000){
 const deadline=Date.now()+timeout;let state;
 do{state=await read();if(predicate(state))return state;await delay(100);}while(Date.now()<deadline);
 assert.fail('State did not settle: '+JSON.stringify(state));
}
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
  const toolList=(await mcpClient.listTools()).tools.map(t=>t.name);assert.ok(toolList.includes('open_robot_cad'));assert.ok(toolList.includes('simulation_manipulate_game_piece'));assert.ok(toolList.includes('simulation_view'));
  const mcpCall=async(name,args={})=>{const result=await mcpClient.callTool({name,arguments:args},undefined,{timeout:90000});assert.ok(!result.isError,JSON.stringify(result));return result;};
  assert.equal(JSON.parse((await mcpCall('workspace_context')).content[0].text).workspace,folder);
  assert.ok(toolList.includes('open_svg_preview'));
  const previewSvg=path.join(folder,'flat-preview.svg');
  await fs.writeFile(previewSvg,'<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="50mm" viewBox="0 0 80 50"><path d="M0 0H80V50H0Z" fill="none" stroke="black"/></svg>');
  const previewOpened=JSON.parse((await mcpCall('open_svg_preview',{file:'flat-preview.svg'})).content[0].text);
  assert.equal(previewOpened.file,previewSvg);assert.equal(previewOpened.ok,true);
  assert.ok(vscode.window.tabGroups.all.some(group=>group.tabs.some(tab=>tab.input?.uri?.fsPath===previewSvg)), 'SVG preview tab must be open');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  const doctor=await api.doctor();assert.equal(doctor.ok,false);
  assert.equal(doctor.checks.find(c=>c.id==='native-engine').ok,true);
  const initialConfigFile=path.join(folder,'.cadcove/project.json'),initialConfig=JSON.parse(await fs.readFile(initialConfigFile,'utf8'));initialConfig.entryPoint='models.py';await fs.writeFile(initialConfigFile,JSON.stringify(initialConfig));
  const entry=path.join(folder,'cad/models.py');
  // Present complete edits to the watcher/cache poller, not the empty interval
  // between writeFile's truncate and write. Assertions still check exact errors.
  const replaceEntry=async text=>{const temporary=path.join(path.dirname(entry),'.models.py.test-tmp');await fs.writeFile(temporary,text);await fs.rename(temporary,entry);};
  const code=`import cadquery as cq
def build(ctx):
    plate=cq.Workplane('XY').box(100,80,5,centered=False).edges().fillet(1).cut(cq.Workplane('XY').center(30,40).circle(4).extrude(9).translate((0,0,-2)))
    return [dict(id='base',name='Base',color='#dd4400',shape=plate),dict(id='upright',name='Upright',color='#4488ff',shape=cq.Workplane('XY').box(5,20,60,centered=False).translate((10,10,5)))]
`;

  const testPython=process.env.CADCOVE_PYTHON;
  if(testPython){
   initialConfig.pythonPath=testPython;
   await fs.writeFile(initialConfigFile,JSON.stringify(initialConfig));
   delete process.env.CADCOVE_PYTHON;
   await vscode.workspace.getConfiguration('instantcad').update('pythonPath','missing-cad-python',vscode.ConfigurationTarget.Workspace);
  }
  await replaceEntry(code);
  await fs.writeFile(path.join(folder,'cad/mechanism.json'),JSON.stringify({schema:1,units:'mm-deg',bodies:[{id:'frame',fixed:true,origin:[0,0,0],parts:['base']},{id:'arm',fixed:false,origin:[10,10,5],parts:['upright']}],joints:[{id:'arm-axis',type:'revolute',parent:'frame',child:'arm',origin:[10,10,5],axis:[0,0,1],limitsDeg:[-180,180]}],relations:[]}));
  const helper=path.join(folder,'cad/helper.py');
  await fs.writeFile(helper,'"""\nresult = example\n"""\ndef helper(): pass\n');
  const waitMenu=async predicate=>{const until=Date.now()+10000;while(Date.now()<until){if(predicate(api.modelMenuEntries()))return;await delay(50);}throw Error('Explorer model index did not update: '+JSON.stringify({folder,entries:api.modelMenuEntries(),files:(await vscode.workspace.findFiles('**/*.py')).map(uri=>uri.fsPath)}));};
  await waitMenu(paths=>paths.includes(entry));
  assert.ok(!api.modelMenuEntries().includes(helper),'Helper and docstring are not model entries');
  await fs.writeFile(helper,'result = None\n');
  await waitMenu(paths=>paths.includes(helper));
  await fs.unlink(helper);
  await waitMenu(paths=>!paths.includes(helper));
  const waitFor=async(predicate,timeout=60000)=>{const until=Date.now()+timeout;while(Date.now()<until){const state=api.getDiagnostics()[0];if(predicate(state))return state;await delay(100);}throw Error('Timed out: '+JSON.stringify(api.getDiagnostics()));};
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
  const motion=async args=>JSON.parse((await mcpCall('cad_motion',args)).content[0].text);
  assert.equal((await motion({action:'list'})).joints[0].id,'arm-axis');
  assert.deepEqual(JSON.parse((await mcpCall('cad_selection')).content[0].text).selectedIds,[]);
  const trajectory={units:'deg-s',tracks:[{target:'upright',endPosition:30,segments:[{seconds:.1,acceleration:3000},{seconds:.1,acceleration:-3000}]}]};
  const playing=await motion({action:'play',trajectory});assert.ok(playing.playback.id);
  await motion({action:'pause'});const sought=await motion({action:'seek',seconds:.1});assert.equal(sought.angles['arm-axis'],15);
  await motion({action:'resume'});
  const completed=await waitState(()=>motion({action:'state'}),s=>s.playback?.status==='completed');assert.equal(completed.playback.status,'completed');assert.equal(completed.angles['arm-axis'],30);
  assert.equal((await motion({action:'move',part:'arm-axis',degrees:15})).angles['arm-axis'],45);
  const mechanismFile=path.join(folder,'cad/mechanism.json');
  const definition=JSON.parse(await fs.readFile(mechanismFile,'utf8'));
  const sceneBefore=await fs.stat(path.join(cache,'scene.bin'));
  definition.motors=[{id:'new-motor',joint:'arm-axis'}];
  await fs.writeFile(mechanismFile,JSON.stringify(definition));await delay(300);
  const updateStart=Date.now();
  assert.equal((await motion({action:'move',part:'new-motor',degrees:5})).angles['arm-axis'],50);
  const metadataCommandMs=Date.now()-updateStart;
  assert.equal(api.getDiagnostics()[0].revision,initial.revision);
  assert.equal((await fs.stat(path.join(cache,'scene.bin'))).mtimeMs,sceneBefore.mtimeMs,'metadata must not rewrite geometry cache');
  assert.equal((await query('cad-status')).sourceRevision,initial.revision);
  await motion({action:'reset'});assert.equal(api.getDiagnostics()[0].revision,initial.revision);
  const motionReport={playbackId:playing.playback.id,completed:true,seekDegrees:15,noSourceRebuild:true,metadataHotReload:true,metadataCommandMs};

  assert.equal((await query('cad-status')).sourceRevision,initial.revision);
  const preview=await query('cad-preview');assert.equal(preview.ok,true);assert.equal(preview.acceptedRevision,initial.revision);assert.equal(preview.image,path.join(cache,'preview.png'));
  await replaceEntry(code.replace('100,80,5','140,80,5'));
  const edited=await waitFor(s=>s?.phase==='ready'&&s.revision!==initial.revision);
  assert.equal(edited.parts,2);
  await replaceEntry('raise ValueError("intentional failed CAD edit")');
  const failed=await waitFor(s=>s?.phase==='error');assert.match(failed.error,/intentional failed CAD edit/);assert.equal(failed.revision,edited.revision);assert.equal(failed.parts,2);
  await replaceEntry(code.replace('100,80,5','140,80,5'));await waitFor(s=>s?.phase==='ready');
  assert.equal((await query('cad-status')).ok,true,'Restored source clears failed CLI feedback');
  api.closeAll();await delay(300);
  await fs.writeFile(path.join(cache,'status.json'),JSON.stringify({ok:false,revision:edited.revision,error:'stale prior error'}));
  await api.openModel();
  const cached=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');
  assert.equal(cached.phase,'ready',JSON.stringify(cached));assert.ok(['disk-cache','unchanged'].includes(cached.source));assert.equal(cached.revision,edited.revision);assert.equal(cached.parts,edited.parts);assert.ok(cached.gpuBytes>0);assert.equal(cached.workerLoaded,false);
  assert.equal((await query('cad-status')).ok,true,'Validated cache clears stale CLI feedback without loading the worker');
  let externalBuildRecovery;
  if(testPython){
   api.closeAll();await delay(300);
   await fs.writeFile(initialConfigFile,JSON.stringify({...initialConfig,pythonPath:'missing-cad-python'}));
   await api.openModel();await waitFor(s=>s?.phase==='ready');
   const oldCamera=api.getDiagnostics()[0].camera;
   await replaceEntry(code.replace('100,80,5','160,80,5'));
   const interpreterFailure=await waitFor(s=>s?.phase==='error');
   assert.match(interpreterFailure.error,/Cannot start CadQuery Python/);
   const cliBuild=JSON.parse((await execute(runtime,['cad-build','--workspace',folder,'--python',testPython],{maxBuffer:4*1024*1024})).stdout);
   assert.equal(cliBuild.ok,true);
   const recovered=await waitFor(s=>s?.phase==='ready'&&s.revision===cliBuild.revision);
   assert.ok(['disk-cache','unchanged'].includes(recovered.source),'Open viewer adopts an external CLI build without restarting Python');assert.ok(recovered.gpuBytes>0);
   assert.deepEqual(recovered.camera,oldCamera,'External build preserves the current camera');
   assert.equal((await query('cad-status')).ok,true);
   externalBuildRecovery={interpreterFailure:true,revision:recovered.revision,source:recovered.source,cameraPreserved:true};
   await fs.writeFile(initialConfigFile,JSON.stringify(initialConfig));
   process.env.CADCOVE_PYTHON=testPython;
  }
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
  const report={motion:motionReport,ok:true,externalBuildRecovery,editorVersion:vscode.version,companions,wpilibActive:companions?true:undefined,extensionPath:extension.extensionPath,runtime,occt:buildProvenance.occt,runtimeIdentity:buildProvenance.runtimeIdentity,initialized:true,doctorFindsNative:true,initial,edited,cached,failedBuildPreservesScene:true,preview:true,actualInstalledVSIX:true,runtimeRepair:{command:true,oldRuntime,newRuntime:runtime,activeNativePreserved:true,healthyRepeatReused:true}};
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
      assert.ok(['disk-cache','unchanged'].includes(nativeTeam.source));assert.ok(nativeTeam.gpuBytes>0);assert.equal(nativeTeam.workerLoaded,false);
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
    await fs.writeFile(cameraOptions,JSON.stringify({bodies:['chassis'],fit:true,follow:false}));
    const isolated=JSON.parse((await execute(runtime,['sim-view','--project',project,'--options',cameraOptions])).stdout);
    assert.deepEqual(isolated.bodies,['chassis']);assert.equal(isolated.physicsScope,'unchanged');assert.ok(isolated.visibleInstances>0&&isolated.visibleInstances<view.instances);
    await fs.writeFile(optionsFile,JSON.stringify({scope:'scene',width:320,height:240}));
    const isolatedCapture=JSON.parse((await execute(runtime,['sim-capture','--project',project,'--options',optionsFile])).stdout);
    assert.equal(isolatedCapture.instanceIds.length,isolated.visibleInstances);assert.equal(isolatedCapture.runId,state.runId);
    await fs.writeFile(cameraOptions,JSON.stringify({bodies:['nonexistent-body']}));
    await assert.rejects(execute(runtime,['sim-view','--project',project,'--options',cameraOptions]));
    await fs.writeFile(cameraOptions,JSON.stringify({bodies:null}));
    const restored=JSON.parse((await execute(runtime,['sim-view','--project',project,'--options',cameraOptions])).stdout);
    assert.equal(restored.bodies,null);assert.equal(restored.visibleInstances,view.instances);
    const practiceOptions=path.join(folder,'practice-options.json');await fs.writeFile(practiceOptions,JSON.stringify({action:'start',input:'keyboard'}));
    await assert.rejects(execute(runtime,['sim-practice','--project',project,'--options',practiceOptions]),/Command failed/);
    await vscode.window.showTextDocument(vscode.Uri.file(entry),{viewColumn:vscode.ViewColumn.One});await delay(300);
    report.simulationView={...view,capture:{image:capture.image,sha256:capture.sha256,tick:capture.tick,width:capture.width,height:capture.height},cliCamera:true,viewOnly:true};
    const priorCamera=api.simulationDiagnostics()[0].camera;
    assert.equal((await api.stopSimulation()).ok,true);
    const lock=path.join(manifest.build,'.cadcove-session-lock'),until=Date.now()+15000;
    while(Date.now()<until&&await fs.access(lock).then(()=>true,()=>false))await delay(100);
    await assert.rejects(fs.access(lock));await assert.rejects(fs.access(path.join(manifest.build,'cadcove-session.json')));simulationStarted=false;
    // Keep the old panel open across a native session restart. Opening must
    // replace its session identity and retain the user's camera.
    const taskEndDeadline=Date.now()+15000;
    while(true){try{assert.equal((await api.startSimulation()).status,'starting');break;}catch(error){if(!String(error).includes('already has a simulation')||Date.now()>taskEndDeadline)throw error;await delay(200);}}
    simulationStarted=true;
    let restarted;const restartUntil=Date.now()+60000;
    while(Date.now()<restartUntil){try{restarted=JSON.parse((await execute(runtime,['sim-state','--project',project])).stdout).result;if(restarted?.state?.tick>=1&&restarted.runId!==state.runId)break;}catch{}await delay(200);}
    assert.ok(restarted?.runId&&restarted.runId!==state.runId);
    await api.openSimulation();let reopened;const reopenUntil=Date.now()+60000;
    while(Date.now()<reopenUntil){reopened=api.simulationDiagnostics()[0];if(reopened?.phase==='ready'&&reopened.runId===restarted.runId)break;await delay(100);}
    assert.equal(reopened?.phase,'ready');assert.equal(reopened.runId,restarted.runId);
    assert.deepEqual(reopened.camera,priorCamera);
    report.simulationView.reopenPreservesCamera=true;
    api.closeSimulationViews();await api.stopSimulation();simulationStarted=false;
    report.simulation={launchedFromInstalledExtension:true,packagedCLI:true,runId:state.runId,tickBefore:state.state.tick,tickAfter:after.state.tick,controlMode:after.controlMode,cleanShutdown:true};
  }
  if(process.env.CADCOVE_PYTHON){
    api.closeAll();
    const project=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(project,'utf8');
    const config=JSON.parse(saved);config.entryPoint='native.py';
    const nativeEntry=path.join(folder,config.sourceDirectory,'native.py');
    const source=`import cadquery as cq\ndef build(ctx):\n    return [{'id':'native-part','color':'#e64b36','shape':ctx.component('part',lambda:cq.Workplane('XY').box(30,40,5),dependencies=['native.py'])}]\n`;
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
      api.closeAll();await delay(200);
      await preferences.update('pythonPath',testPython,vscode.ConfigurationTarget.WorkspaceFolder);
      await mcpCall('open_robot_cad');
      await waitFor(s=>s?.phase==='ready');
      // New source revision, unchanged component: a fresh worker must use BREP
      // and mesh from disk, rather than merely display the old scene cache.
      await fs.writeFile(path.join(folder,config.sourceDirectory,'cache-probe.json'),'{}');
      const diskEdit=await waitFor(s=>s?.phase==='ready'&&s.revision!==edit.revision);
      const diskFeedback=await query('cad-status');
      assert.equal(diskFeedback.timings.components.diskHits,1);
      assert.equal(diskFeedback.timings.components.misses,0);
      report.nativeCad={first,edit,cached:cachedNative,diskEdit,diskComponents:diskFeedback.timings.components,mcpOpen:true,mcpCapture:true,packagedCliFeedback:true,cameraPreserved:true};
    }finally{api.closeAll();await fs.writeFile(project,saved);}
  }
  if(process.env.CADCOVE_TEST_MOTION_WORKSPACE){
    // Copy local fixtures; never edit the student's live assembly or its cache.
    const original=process.env.CADCOVE_TEST_MOTION_WORKSPACE;
    const originalConfig=JSON.parse(await fs.readFile(path.join(original,'.cadcove/project.json'),'utf8'));
    const project=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(project);
    api.closeAll();await delay(200);
    try{
      await fs.cp(path.join(original,originalConfig.sourceDirectory),path.join(folder,'motion-cad'),{recursive:true});
      await fs.cp(path.join(original,originalConfig.buildDirectory,'cad-cache',originalConfig.entryPoint),path.join(folder,'motion-build','cad-cache',originalConfig.entryPoint),{recursive:true});
      await fs.writeFile(project,JSON.stringify({...originalConfig,sourceDirectory:'motion-cad',buildDirectory:'motion-build',pythonPath:testPython}));
      await api.openModel(vscode.Uri.file(path.join(folder,'motion-cad',originalConfig.entryPoint)));
      // A new native worker fingerprint invalidates old component certificates.
      // Match the native full-assembly build budget; motion itself is timed below.
      const ready=await waitFor(s=>s?.phase==='ready'||s?.phase==='error',process.platform==='win32'?900000:300000);assert.equal(ready.phase,'ready',JSON.stringify(ready));
      const manifest=path.join(folder,'motion-cad',path.dirname(originalConfig.entryPoint),'mechanism.json');
      const definition=JSON.parse(await fs.readFile(manifest,'utf8')),joint=definition.joints[0];
      const sceneFile=path.join(folder,'motion-build','cad-cache',originalConfig.entryPoint,'scene.bin'),before=await fs.stat(sceneFile);
      const angle=joint.bindAngleDeg??0;
      await motion({action:'rotate',part:joint.id,degrees:angle+10});
      definition.motors??=[];definition.motors.push({id:'test-live-motor',joint:joint.id});
      await fs.writeFile(manifest,JSON.stringify(definition));await delay(300);
      const start=Date.now();
      const result=await motion({action:'animate',part:'test-live-motor',rpm:1,seconds:.3});
      const commandMs=Date.now()-start;assert.equal(result.running,true);
      await delay(600);const ended=await motion({action:'state'});
      assert.equal(ended.running,false);assert.ok(Math.abs(ended.angles[joint.id]-(angle+11.8))<1e-6);
      assert.equal(api.getDiagnostics()[0].revision,ready.revision);
      assert.equal((await fs.stat(sceneFile)).mtimeMs,before.mtimeMs);
      await motion({action:'reset'});
      report.fullAssemblyMotion={parts:ready.parts,commandMs,metadataHotReload:true,posePreserved:true,noGeometryCacheWrite:true,completed:true};
      if(process.env.CADCOVE_RAPIER_MATE_SOLVER){
        // Exercise the installed agent CLI, not a precomputed/relabelled solution.
        const canvas=async(options,target)=>{const r=await mcpClient.callTool({name:'canvas_command',arguments:{action:'motion',options,target}},undefined,{timeout:90000});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};
        const drives=[['axis/22',5],['axis/27',-5],['axis/24',90],['axis/29',90],['axis/23',-2],['axis/28',-2],['steer/0',15],['drive/1',90],['axis/12',-5]].map(([joint,velocity])=>({joint,velocity}));
        const input=path.join(folder,'agent-motion.json');await fs.writeFile(input,JSON.stringify({duration:2,samplePeriod:.05,drives}));
        const timings={};
        for(const target of ['cad','field']){
          if(target==='field')await mcpCall('open_mechanism_preview',{field:false});
          await canvas({action:'rotate',part:'axis/22',degrees:40},target);
          const prior=await canvas({action:'state'},target),output=path.join(folder,'agent-'+target+'-solution.json'),started=Date.now();
          const called=await execute(runtime,['cad-mates','--action','animate','--workspace',folder,'--target',target,'--input',input,'--output',output,'--solver',process.env.CADCOVE_RAPIER_MATE_SOLVER,'--python',testPython],{timeout:90000,maxBuffer:8*1024*1024});
          const result=JSON.parse(called.stdout);timings[target]=Date.now()-started;
          assert.equal(result.ok,true);assert.equal(result.noGeometryBuild,true);assert.equal(result.solver,'Rapier');
          assert.equal(result.playback.running,true);
          await canvas({action:'pause'},target);
          const solution=JSON.parse(await fs.readFile(output,'utf8')),last=solution.frames.at(-1);
          assert.equal(solution.sourceRevision,ready.revision);
          assert.ok(Math.abs(solution.frames[0].angles['axis/22']-40)<1e-6);
          const actual=await canvas({action:'seek',seconds:last.time},target);
          for(const d of drives)assert.ok(Math.abs(actual.angles[d.joint]-(prior.angles[d.joint]+2*d.velocity))<1e-6,d.joint);
          assert.ok(Math.abs(actual.angles['flywheel/left/secondary/axis']-2*actual.angles['axis/24'])<1e-6);
          assert.ok(Math.abs(actual.angles['axis/12']-(prior.angles['axis/12']-10))<1e-6,'Existing intake pivot animation remains available');
          await canvas({action:'reset'},target);
        }
        api.closeMechanismPreviews();
        assert.equal((await fs.stat(sceneFile)).mtimeMs,before.mtimeMs);
        report.fullAssemblyAgentSolve={parts:ready.parts,solver:'Rapier',cad:true,field:true,posedStart:true,shooters:true,hoods:true,turrets:true,steeringAndSpin:true,intakeAnimated:true,noGeometryCacheWrite:true,commandMs:timings};
      }
      if(process.env.CADCOVE_TEST_ROBOT_SOLUTION){
        const solution=JSON.parse(await fs.readFile(process.env.CADCOVE_TEST_ROBOT_SOLUTION,'utf8'));solution.sourceRevision=ready.revision;
        const solutionFile='robot-solved-motion.json';await fs.writeFile(path.join(folder,solutionFile),JSON.stringify(solution));
        const canvas=async(options,target)=>{const r=await mcpClient.callTool({name:'canvas_command',arguments:{action:'motion',options,target}},undefined,{timeout:90000});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};
        for(const target of ['cad','field']){
          if(target==='field')await mcpCall('open_mechanism_preview',{field:false});
          await canvas({action:'play-solved',solutionFile},target);await canvas({action:'pause'},target);
          const last=solution.frames.at(-1),actual=await canvas({action:'seek',seconds:last.time},target);
          for(const [joint,value] of Object.entries(last.angles))assert.ok(Math.abs(actual.angles[joint]-value)<1e-6,joint);
          await canvas({action:'reset'},target);
        }
        api.closeMechanismPreviews();
        assert.equal((await fs.stat(sceneFile)).mtimeMs,before.mtimeMs);
        report.fullAssemblySolved={parts:ready.parts,frames:solution.frames.length,bodies:solution.bodies.length,cad:true,fieldPreview:true,posedStart:solution.bodies.some(b=>b.bindPose),noGeometryCacheWrite:true};
      }
    }finally{api.closeAll();await fs.writeFile(project,saved);}
  }
  if(testPython&&['CADCOVE_FREECAD','CADCOVE_GMSH','CADCOVE_CCX'].every(k=>process.env[k])){
    api.closeAll();await delay(200);
    const configFile=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(configFile),dir=path.join(folder,'analysis-cad');
    try{
      await fs.mkdir(dir,{recursive:true});
      await fs.writeFile(path.join(dir,'models.py'),"import cadquery as cq\ndef build(ctx):\n return [dict(id='beam',shape=cq.Workplane('XY').box(100,10,10,centered=(False,False,False)))]\n");
      await fs.writeFile(configFile,JSON.stringify({schema:1,sourceDirectory:'analysis-cad',buildDirectory:'analysis-build',entryPoint:'models.py',pythonPath:testPython}));
      const input=path.join(folder,'analysis-input.json'),reviewFile=path.join(folder,'analysis-review.json');
      await fs.writeFile(input,JSON.stringify({schema:1,analysis:'linearStatic',units:'mm-N-MPa',parts:[{id:'beam'}],outputs:['displacement']}));
      const run=async args=>JSON.parse((await execute(runtime,['cad-analysis',...args,'--workspace',folder,'--python',testPython],{timeout:180000,maxBuffer:8*1024*1024})).stdout);
      const review=await run(['--action','prepare','--input',input,'--output',reviewFile]);
      assert.equal(review.inputComplete,false);assert.ok(review.questions.some(q=>q.field==='loads'));assert.match(review.request.parts[0].shapeHash,/^[a-f0-9]{64}$/);
      const analysis=review.request;analysis.parts[0].material={name:'synthetic steel',source:'analytical regression only',youngsModulusMPa:210000,poissonRatio:.3};
      analysis.supports=[{id:'fixed',part:'beam',reference:'mount',source:'fixture',restrainedTranslations:[true,true,true]}];
      analysis.loads=[{id:'pull',part:'beam',reference:'end',source:'fixture',forceN:[1000,0,0]}];
      const request={analysis,references:[{id:'mount',part:'beam',kind:'plane',point:[0,5,5],axis:[-1,0,0]},{id:'end',part:'beam',kind:'plane',point:[100,5,5],axis:[1,0,0]}],mesh:{sizesMm:[5,3],relativeTolerance:.01}};
      await fs.writeFile(input,JSON.stringify(request));
      const solved=await run(['--action','solve','--input',input,'--output',path.join(folder,'analysis-result')]);
      assert.equal(solved.solved,true);assert.equal(solved.convergence.passed,true);assert.equal(solved.sourceRevision,review.sourceRevision);assert.equal(solved.engineeringValidated,false);
      const error=Math.abs(solved.runs.at(-1).maxDisplacementMm/(1000*100/(100*210000))-1);assert.ok(error<.01);
      report.agentFea={preparedFromCad:true,solved:true,converged:true,analyticalRelativeError:error,sourceRevision:solved.sourceRevision};
    }finally{api.closeAll();await fs.writeFile(configFile,saved);}
  }
  // Standalone hierarchy: no robot IDs, geometry, Java or Driver Station.
  {
    api.closeAll();await delay(200);
    const configFile=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(configFile);
    const dir=path.join(folder,'nested-cad');await fs.mkdir(dir,{recursive:true});
    const p={massKg:1,centerOfMassMm:[0,0,0],principalInertiaKgMm2:[1000,1000,1000],friction:0,colliders:[{kind:'box',halfMm:[2,2,2],centerMm:[0,0,0]}],provenance:'Synthetic installed integration test'};
    const electrical={rotorPerUnit:1,efficiency:1,resistance:1,torqueConstant:.02,velocityConstant:60,currentLimit:10};
    const definition={schema:1,units:'mm-deg',bodies:[{id:'base',fixed:true,origin:[0,0,0],parts:['base'],physics:p},{id:'carrier',fixed:false,origin:[30,0,0],parts:['carrier'],physics:p},{id:'wheel',fixed:false,origin:[50,0,0],parts:['wheel'],physics:p}],joints:[{id:'spin',type:'revolute',parent:'carrier',child:'wheel',origin:[50,0,0],axis:[0,1,0],damping:.001},{id:'steer',type:'revolute',parent:'base',child:'carrier',origin:[30,0,0],axis:[0,0,1],damping:.001}],relations:[],motors:[{id:'steer-motor',joint:'steer',physics:electrical},{id:'spin-motor',joint:'spin',physics:electrical}]};
    try{
      await fs.writeFile(path.join(dir,'models.py'),"import cadquery as cq\ndef build(ctx):\n    return [dict(id=n,name=n,color='#4488ff',shape=cq.Workplane('XY').box(10,8,6).translate((x,0,0))) for n,x in [('base',0),('carrier',30),('wheel',50)]]\n");
      await fs.writeFile(path.join(dir,'mechanism.json'),JSON.stringify(definition));
      await fs.writeFile(configFile,JSON.stringify({schema:1,sourceDirectory:'nested-cad',buildDirectory:'nested-build',entryPoint:'models.py',pythonPath:testPython,simulationProject:'nested-preview.sim.json'}));
      await api.openModel(vscode.Uri.file(path.join(dir,'models.py')));const ready=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');assert.equal(ready.phase,'ready',JSON.stringify(ready));
      const canvas=async(action,options={},target)=>{const result=await mcpClient.callTool({name:'canvas_command',arguments:{action,options,target}},undefined,{timeout:90000});if(result.isError)throw Error(result.content[0].text);return JSON.parse(result.content[0].text);};
      const sourceCaps=await canvas('capabilities',{},'cad');assert.equal(sourceCaps.units.length,'mm');assert.ok(sourceCaps.commands.includes('motion'));assert.ok(sourceCaps.commands.includes('physics'));
      const rapierCheck=async target=>{
        const cache=path.join(folder,'nested-build/cad-cache/models.py/scene.bin'),stamp=(await fs.stat(cache)).mtimeMs;
        const input=path.join(folder,'rapier-motion-'+target+'.json'),output=path.join(folder,'rapier-solved-'+target+'.json');
        await fs.writeFile(input,JSON.stringify({duration:.4,samplePeriod:.02,drives:[{joint:'steer',velocity:75},{joint:'spin',velocity:150}]}));
        await canvas('motion',{action:'reset'},target);
        const camera=(await canvas('state',{},target)).camera;
        const called=await execute(runtime,['cad-mates','--action','animate','--workspace',folder,'--target',target,'--input',input,'--output',output,'--python',testPython],{timeout:90000,maxBuffer:8*1024*1024});
        const result=JSON.parse(called.stdout);assert.equal(result.solver,'Rapier');assert.equal(result.noGeometryBuild,true);
        await canvas('motion',{action:'pause'},target);
        const end=await canvas('motion',{action:'seek',seconds:.4},target);
        assert.ok(Math.abs(end.angles.steer-30)<1e-3);assert.ok(Math.abs(end.angles.spin-60)<1e-3);
        assert.deepEqual((await canvas('state',{},target)).camera,camera);
        assert.equal((await fs.stat(cache)).mtimeMs,stamp);
        await canvas('motion',{action:'reset'},target);
        report.rapierMates??={};report.rapierMates[target]={packagedCLI:true,sharedMates:true,steeringAndSpin:true,cameraPreserved:true,noGeometryCacheWrite:true};
      };
      await rapierCheck('cad');
      await canvas('view',{camera:{target:[30,0,0],distance:200}},'cad');assert.equal((await canvas('state',{},'cad')).camera.distance,200);
      assert.ok(sourceCaps.commands.includes('opacity'));
      await canvas('opacity',{action:'set',scope:'except',ids:['wheel'],value:.25},'cad');
      assert.deepEqual((await canvas('opacity',{},'cad')).parts.map(p=>p.id).sort(),['base','carrier']);
      await canvas('opacity',{action:'reset',scope:'all'},'cad');
      const trajectory={units:'deg-s',tracks:['steer','spin'].map((target,i)=>({target,endPosition:30*(i+1),segments:[{seconds:.2,acceleration:750*(i+1)},{seconds:.2,acceleration:-750*(i+1)}]}))};
      await motion({action:'play',trajectory});await motion({action:'pause'});const nested=await motion({action:'seek',seconds:.4});assert.equal(nested.angles.steer,30);assert.equal(nested.angles.spin,60);
      // A single existing native prototype becomes a synthetic field obstacle.
      const meshBytes=await fs.readFile(path.join(folder,'nested-build/cad-cache/models.py/scene.bin'));
      const oldHeader=meshBytes.readUInt32LE(4),meta=JSON.parse(meshBytes.subarray(8,8+oldHeader).toString())[0],header=Buffer.from(JSON.stringify([meta]));
      const offset=(8+header.length+3)&~3,oldOffset=(8+oldHeader+3)&~3,bytes=Buffer.alloc(offset+4*(meta.p+meta.n+meta.i));
      bytes.writeUInt32LE(0x31444349,0);bytes.writeUInt32LE(header.length,4);header.copy(bytes,8);meshBytes.copy(bytes,offset,oldOffset,oldOffset+4*(meta.p+meta.n+meta.i));
      const fieldDir=path.join(folder,'nested-field');await fs.mkdir(fieldDir,{recursive:true});await fs.writeFile(path.join(fieldDir,'obstacle.bin'),bytes);
      await fs.writeFile(path.join(fieldDir,'catalog.json'),JSON.stringify({obstacle:{mesh:'obstacle.bin',meshSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')}}));
      await fs.writeFile(path.join(fieldDir,'instances.json'),JSON.stringify([{id:'obstacle',asset:'obstacle',color:'#888888',transform:[1,0,0,100,0,1,0,0,0,0,1,0]}]));
      const fieldInstances=await fs.readFile(path.join(fieldDir,'instances.json'));
      await fs.writeFile(path.join(fieldDir,'assembly.json'),JSON.stringify({schema:1,sourceHash:require('node:crypto').createHash('sha256').update(fieldInstances).digest('hex')}));
      await fs.writeFile(path.join(fieldDir,'appearance.json'),JSON.stringify({schema:1,instancesHash:require('node:crypto').createHash('sha256').update(fieldInstances).digest('hex'),catalog:{},instances:{obstacle:{color:'#888888',opacity:.2}}}));
      await fs.writeFile(path.join(folder,'nested-preview.sim.json'),JSON.stringify({cad:{field:'nested-field'}}));
      const started=Date.now(),opened=JSON.parse((await mcpCall('open_mechanism_preview',{field:true})).content[0].text);assert.equal(opened.unifiedScene,true);const previewOpenMs=Date.now()-started;
      const req=async(action,options={})=>{const result=await mcpClient.callTool({name:'mechanism_preview',arguments:{action,options}},undefined,{timeout:90000});if(result.isError)throw Error(result.content[0].text);return JSON.parse(result.content[0].text);};
      const fieldCaps=await canvas('capabilities');assert.equal(fieldCaps.units.length,'mm');assert.ok(fieldCaps.commands.includes('physics'));
      await rapierCheck('field');
      await canvas('view',{camera:{target:[30,0,0],distance:200}});assert.equal((await canvas('state')).camera.distance,200);assert.equal((await req('state')).camera.distance,200);
      const materialAlpha=async()=> (await canvas('opacity')).parts.find(p=>p.id==='field/obstacle')?.opacity;
      assert.ok(Math.abs(await materialAlpha()-.2)<1e-6);
      await canvas('opacity',{action:'set',ids:['field/obstacle'],value:.7});
      await canvas('opacity',{action:'reset',ids:['field/obstacle']});assert.ok(Math.abs(await materialAlpha()-.2)<1e-6);
      await canvas('selection',{ids:['wheel','field/obstacle']});
      const alias=JSON.parse((await mcpCall('cad_selection',{})).content[0].text);assert.deepEqual(alias.selectedIds,['wheel','field/obstacle']);
      await canvas('highlight',{action:'set',parts:[{id:'wheel'}]});await canvas('visibility',{action:'isolate',ids:['wheel']});assert.ok((await canvas('state')).selection.hiddenIds.includes('base'));await canvas('visibility',{action:'show-all'});
      await canvas('opacity',{action:'set',scope:'only',ids:['base','carrier'],value:.25});

      assert.deepEqual((await req('state')).selection.selectedIds,['wheel','field/obstacle']);
      await canvas('motion',{action:'play',trajectory});await canvas('motion',{action:'pause'});await canvas('motion',{action:'seek',seconds:.4});const animated=await req('state');assert.equal(animated.motion.angles.spin,60);
      await canvas('place',{position:[2000,3000,500]});
      assert.equal((await canvas('motion',{action:'state'})).angles.spin,60);
      let physics;const physicsUntil=Date.now()+30000;do{physics=await req('physics');if(!physics.ok){assert.equal(physics.pending,true,JSON.stringify(physics));await delay(100);}}while(!physics.ok&&Date.now()<physicsUntil);assert.equal(physics.mode,'physics');
      const handed=await waitState(()=>req('state'),s=>s.physics?.joints?.spin&&s.physics?.joints?.steer);assert.ok(Number.isFinite(handed.physics.joints.spin.position));assert.ok(Number.isFinite(handed.physics.joints.steer.position));
      await req('motors',{volts:{'steer-motor':.2,'spin-motor':.2},seconds:.3});await delay(600);
      const driven=await req('state');assert.deepEqual(driven.selection.selectedIds,['wheel','field/obstacle']);assert.equal(driven.mode,'physics');assert.ok(driven.physics.tick>0);assert.ok(Math.abs(driven.physics.joints.spin.position)>.001);assert.ok(Math.abs(driven.physics.joints.steer.position)>.001);
      assert.deepEqual(driven.selection.opacity.parts.filter(p=>p.id!=='field/obstacle').map(p=>[p.id,p.opacity]).sort(),[['base',.25],['carrier',.25]]);
      const capture=await req('capture');assert.ok((await fs.stat(capture.image)).size>1000);
      await req('cad');assert.equal((await req('state')).mode,'cad');
      const changed={...definition,motors:[]};await fs.writeFile(path.join(dir,'mechanism.json'),JSON.stringify(changed));
      await delay(500);await assert.rejects(()=>req('motors',{volts:{'spin-motor':1},seconds:.1}),/Invalid motor|Start physics/);
      report.unifiedMechanism={fieldMaterialOpacity:true,commonCommands:true,opacityAcrossCADFieldAndPhysics:true,consistentCameraUnits:true,activeCanvasAliases:true,nestedCAD:true,fieldContext:true,fieldSelection:true,selectionAcrossPhysics:true,currentPoseHandoff:true,previewOpenMs,physicsTick:driven.physics.tick,sharedGeometry:true,noJava:true,removedMotorRejected:true};
    }finally{api.closeMechanismPreviews();api.closeAll();await fs.writeFile(configFile,saved);}
  }
  if(process.env.CADCOVE_SOLVED_BELT_FIXTURE||process.env.CADCOVE_TEST_RAPIER_MATES){
    api.closeAll();await delay(200);
    const configFile=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(configFile),dir=path.join(folder,'solved-belt-cad');
    await fs.mkdir(dir,{recursive:true});
    const model={schema:1,units:'mm-deg',bodies:[{id:'ground',fixed:true,origin:[0,0,0],parts:['world']},{id:'base',fixed:false,origin:[0,0,0],parts:['belt']},...[0,1].map(i=>({id:'b'+i,fixed:false,origin:[i*50,0,0],parts:['p'+i]}))],joints:[{id:'parent',type:'revolute',parent:'ground',child:'base',origin:[0,0,0],axis:[0,0,1]},...[0,1].map(i=>({id:'j'+i,type:'revolute',parent:'base',child:'b'+i,origin:[i*50,0,0],axis:[0,0,1]}))],relations:[{id:'belt-drive',type:'belt',driver:'j0',follower:'j1',driverTeeth:10,followerTeeth:10,direction:1}],beltSurfaces:[{id:'belt',part:'belt',body:'base',relation:'belt-drive',pitchMm:2*Math.PI,direction:-1,widthAxis:[0,0,1],pulleys:[0,50].map(x=>({centerMm:[x,0,0],pitchRadiusMm:10}))}]};
    try{
      await fs.writeFile(path.join(dir,'models.py'),"import cadquery as cq\ndef loop(r):\n    return cq.Workplane('XY').moveTo(0,-r).lineTo(50,-r).threePointArc((50+r,0),(50,r)).lineTo(0,r).threePointArc((-r,0),(0,-r)).close().extrude(3)\ndef build(ctx):\n    return [dict(id='belt',shape=loop(10).cut(loop(8)),color='#ddaa44'),dict(id='world',shape=cq.Workplane('XY').box(2,2,2).translate((-20,-20,0))),*[dict(id='p'+str(i),shape=cq.Workplane('XY').circle(7).extrude(2).translate((i*50,0,0))) for i in range(2)]]\n");
      await fs.writeFile(path.join(dir,'mechanism.json'),JSON.stringify(model));
      await fs.writeFile(configFile,JSON.stringify({schema:1,sourceDirectory:'solved-belt-cad',buildDirectory:'solved-belt-build',entryPoint:'models.py',pythonPath:testPython,simulationProject:'nested-preview.sim.json'}));
      await api.openModel(vscode.Uri.file(path.join(dir,'models.py')));const ready=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');assert.equal(ready.phase,'ready',JSON.stringify(ready));
      let solution;
      if(process.env.CADCOVE_SOLVED_BELT_FIXTURE){solution=JSON.parse(await fs.readFile(process.env.CADCOVE_SOLVED_BELT_FIXTURE,'utf8'));solution.sourceRevision=ready.revision;}
      const canvas=async(options,target)=>{const r=await mcpClient.callTool({name:'canvas_command',arguments:{action:'motion',options,target}},undefined,{timeout:90000});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};
      const cache=path.join(folder,'solved-belt-build/cad-cache/models.py/scene.bin'),stamp=(await fs.stat(cache)).mtimeMs;
      for(const target of ['cad','field']){
        if(target==='field')await mcpCall('open_mechanism_preview',{field:true});
        if(solution)await canvas({action:'play-solved',solution},target);
        else {
          const input=path.join(folder,'rapier-belt-'+target+'.json'),output=path.join(folder,'rapier-belt-solved-'+target+'.json');
          await fs.writeFile(input,JSON.stringify({duration:1,samplePeriod:.01,drives:[{joint:'parent',velocity:30},{joint:'j0',velocity:3600,acceleration:-7200}]}));
          const called=await execute(runtime,['cad-mates','--action','animate','--workspace',folder,'--target',target,'--input',input,'--output',output,'--python',testPython],{timeout:90000,maxBuffer:8*1024*1024});
          assert.equal(JSON.parse(called.stdout).solver,'Rapier');
        }
        await canvas({action:'pause'},target);
        const halfway=await canvas({action:'seek',seconds:.5},target);assert.ok(Math.abs(halfway.angles.j0-900)<(solution?1e-6:1e-3));
        const end=await canvas({action:'seek',seconds:1},target);assert.ok(Math.abs(end.angles.j0)<(solution?1e-6:1e-3));
        await canvas({action:'reset'},target);
      }
      assert.equal((await fs.stat(cache)).mtimeMs,stamp);report.solvedBelts={backend:'Rapier',firstCADCommandLoadsMechanism:true,field:true,fullTurns:true,reversal:true,reset:true,noGeometryCacheWrite:true};
    }finally{api.closeMechanismPreviews();api.closeAll();await fs.writeFile(configFile,saved);}
  }
  // Sheet folding uses the same canvas playback API without mechanism.json.
  {
    api.closeAll();await delay(200);
    const configFile=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(configFile),dir=path.join(folder,'fold-cad');
    await fs.mkdir(dir,{recursive:true});
    try{
      const length=Math.PI/2*3.8;
      await fs.writeFile(path.join(dir,'models.py'),`import cadquery as cq
def build(ctx):
 return [dict(id='strip',color='#73b9df',shape=cq.Workplane('XY').box(10,${length},2).translate((5,${length/2},-1)))]
`);
      await fs.writeFile(configFile,JSON.stringify({schema:1,sourceDirectory:'fold-cad',buildDirectory:'fold-build',entryPoint:'models.py',pythonPath:testPython}));
      await api.openModel(vscode.Uri.file(path.join(dir,'models.py')));const ready=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');assert.equal(ready.phase,'ready',JSON.stringify(ready));
      const canvas=async(action,options={})=>{const r=await mcpClient.callTool({name:'canvas_command',arguments:{action,options,target:'cad',entry:'models.py'}},undefined,{timeout:90000});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};
      assert.equal((await canvas('capabilities')).sheetMetalFolds,true);
      const solution={schema:1,sourceRevision:ready.revision,definition:{schema:1,units:'mm-deg-s',thicknessMm:2,bends:[{id:'bend',origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],angleDeg:90,lengthMm:length,neutralOffsetMm:-.8}],zones:[{id:'strip',chain:['bend'],bend:'bend'}]},tracks:[{bend:'bend',startSeconds:0,seconds:2}],holdSeconds:1};
      const solutionFile='fold-motion.json';await fs.writeFile(path.join(folder,solutionFile),JSON.stringify(solution));
      const cache=path.join(folder,'fold-build/cad-cache/models.py/scene.bin'),stamp=(await fs.stat(cache)).mtimeMs;
      await canvas('view',{camera:{target:[5,3,0],distance:45}});
      await canvas('motion',{action:'play-fold',solutionFile});
      await canvas('selection',{ids:['strip']});
      await canvas('motion',{action:'seek',seconds:1});
      assert.equal((await canvas('state')).motion.playback.kind,'fold');
      await canvas('view',{zoom:.8});assert.equal((await canvas('state')).camera.distance,36);
      await canvas('motion',{action:'resume'});
      const foldState=await waitState(()=>canvas('motion',{action:'state'}),s=>s.playback?.status==='completed');
      assert.equal(foldState.playback.status,'completed',JSON.stringify(foldState));
      assert.deepEqual((await canvas('selection')).selectedIds,['strip']);
      await canvas('motion',{action:'reset'});
      assert.equal((await canvas('motion',{action:'state'})).playback,null);
      await assert.rejects(()=>canvas('motion',{action:'play-fold',solution:{...solution,sourceRevision:'stale'}}),/stale/);
      assert.equal((await fs.stat(cache)).mtimeMs,stamp);
      report.sheetMetalFold={play:true,seek:true,resume:true,reset:true,selection:true,camera:true,staleRejected:true,noGeometryCacheWrite:true};
    }finally{api.closeAll();await fs.writeFile(configFile,saved);}
  }
  // Cutting retains stock/cutouts and shares the local timeline, without mechanism.json.
  {
    api.closeAll();await delay(200);
    const configFile=path.join(folder,'.cadcove/project.json'),saved=await fs.readFile(configFile),dir=path.join(folder,'cut-cad');
    await fs.mkdir(dir,{recursive:true});
    try{
      await fs.writeFile(configFile,JSON.stringify({schema:1,sourceDirectory:'cut-cad',buildDirectory:'cut-build',entryPoint:'preview/models.py',pythonPath:testPython}));
      const request={schema:1,units:'mm-s',stock:{id:'stock',origin:[0,0,0],size:[20,12,3]},tool:{id:'tool',kind:'bit',diameterMm:2,lengthMm:8},resolutionMm:.5,start:[3,3,5],moves:[{mode:'cut',to:[3,3,0],seconds:1},{mode:'cut',to:[17,3,0],seconds:1}]};
      const input=path.join(folder,'cut-input.json');await fs.writeFile(input,JSON.stringify(request));
      const made=JSON.parse((await execute(runtime,['cad-cut-preview','--action','preview','--workspace',folder,'--input',input,'--output',path.join(dir,'preview'),'--python',testPython],{timeout:90000,maxBuffer:4*1024*1024})).stdout);
      await api.openModel(vscode.Uri.file(path.join(dir,'preview/models.py')));const ready=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');assert.equal(ready.phase,'ready',JSON.stringify(ready));
      let cutEntry='preview/models.py';
      const canvas=async(action,options={})=>{const r=await mcpClient.callTool({name:'canvas_command',arguments:{action,options,target:'cad',entry:cutEntry}},undefined,{timeout:90000});if(r.isError)throw Error(r.content[0].text);return JSON.parse(r.content[0].text);};
      assert.equal((await canvas('capabilities')).stockRemoval,true);assert.deepEqual((await canvas('capabilities')).cutTools,['bit','laser']);
      const cache=path.join(folder,'cut-build/cad-cache/preview/models.py/scene.bin'),stamp=(await fs.stat(cache)).mtimeMs;
      await canvas('motion',{action:'play-cut',solutionFile:path.relative(folder,made.playbackFile)});
      await canvas('motion',{action:'seek',seconds:1});assert.equal((await canvas('state')).motion.playback.kind,'cut');
      await canvas('selection',{ids:['stock']});await canvas('view',{camera:{target:[10,6,0],distance:45}});
      await canvas('motion',{action:'resume'});await delay(1500);
      assert.equal((await canvas('motion',{action:'state'})).playback.status,'completed');
      assert.deepEqual((await canvas('selection')).selectedIds,['stock']);assert.equal((await canvas('state')).camera.distance,45);
      await canvas('motion',{action:'reset'});assert.equal((await canvas('motion',{action:'state'})).playback,null);
      assert.equal((await fs.stat(cache)).mtimeMs,stamp);
      api.closeAll();await delay(200);
      const laser={...request,tool:{id:'tool',kind:'laser',diameterMm:1.5,lengthMm:8},start:[3,3,0],moves:[{mode:'cut',to:[17,3,0],seconds:2},{mode:'rapid',to:[17,9,0],seconds:1}]};
      await fs.writeFile(input,JSON.stringify(laser));
      const laserMade=JSON.parse((await execute(runtime,['cad-cut-preview','--action','preview','--workspace',folder,'--input',input,'--output',path.join(dir,'laser'),'--python',testPython],{timeout:90000,maxBuffer:4*1024*1024})).stdout);
      cutEntry='laser/models.py';await api.openModel(vscode.Uri.file(path.join(dir,cutEntry)));
      const laserReady=await waitFor(s=>s?.phase==='ready'||s?.phase==='error');assert.equal(laserReady.phase,'ready',JSON.stringify(laserReady));
      const laserCache=path.join(folder,'cut-build/cad-cache/laser/models.py/scene.bin'),laserStamp=(await fs.stat(laserCache)).mtimeMs;
      await canvas('motion',{action:'play-cut',solutionFile:path.relative(folder,laserMade.playbackFile)});
      await canvas('motion',{action:'seek',seconds:1});
      assert.equal((await canvas('opacity')).parts.find(p=>p.id==='tool')?.opacity??1,1);
      await canvas('selection',{ids:['tool-nozzle']});assert.deepEqual((await canvas('selection')).selectedIds,['tool-nozzle']);
      await canvas('motion',{action:'seek',seconds:2.5});assert.equal((await canvas('opacity')).parts.find(p=>p.id==='tool')?.opacity,0);
      await canvas('motion',{action:'reset'});assert.equal((await canvas('opacity')).parts.find(p=>p.id==='tool')?.opacity,0);
      assert.equal((await fs.stat(laserCache)).mtimeMs,laserStamp);
      report.stockRemoval={cli:true,play:true,seek:true,resume:true,reset:true,selection:true,camera:true,noGeometryCacheWrite:true,laserNozzle:true,laserBeamCutOnly:true};
    }finally{api.closeAll();await fs.writeFile(configFile,saved);}
  }
  await fs.writeFile(reportFile,JSON.stringify(report,null,2));api.closeAll();
 }catch(error){if(simulationStarted){await api?.stopSimulation().catch(()=>{});await delay(1500);simulationStarted=false;}await fs.writeFile(reportFile,JSON.stringify({ok:false,error:String(error.stack),stdout:error.stdout,diagnostics:api?.getDiagnostics()},null,2));api?.closeAll();throw error;}
 finally{await mcpClient?.close();if(simulationStarted)await api?.stopSimulation().catch(()=>{});}
};
