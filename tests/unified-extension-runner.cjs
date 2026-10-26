const vscode=require('vscode'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
exports.run=async()=>{
 const root=vscode.workspace.workspaceFolders[0].uri.fsPath,reportFile=path.join(root,'extension-test-report.json');let api;
 try{
  const ext=vscode.extensions.getExtension(process.env.CADCOVE_TEST_EXTENSION_ID);api=await ext.activate();await api.initializeWorkspace();
  const configFile=path.join(root,'.cadcove/project.json'),config=JSON.parse(await fs.readFile(configFile,'utf8'));
  config.sourceDirectory='cad';config.buildDirectory='build/cad';config.entryPoint='model.py';config.pythonPath=process.env.CADCOVE_PYTHON;await fs.writeFile(configFile,JSON.stringify(config));
  await fs.mkdir(path.join(root,'cad'),{recursive:true});const source=path.join(root,'cad/model.py');
  const py=size=>`import cadquery as cq\ndef build(ctx):\n    return [{"id":"part", "shape":cq.Workplane().box(${size},20,10).val(), "color":"#4488aa"}]\n`;
  await fs.writeFile(source,py(30));
  const body=id=>({id,parts:id==='part'?['part']:[],fixed:false,position:[0,0,id==='part'?.2:.5],inertial:{mass:1,center:[0,0,0],tensor:[.01,.01,.01,0,0,0]},collision:{friction:.3,restitution:.1,shapes:[{kind:'ball',radius:.01,center:[0,0,0]}],membership:id==='part'?1:2,filter:id==='part'?1:2},provenance:{status:'estimated',evidence:'isolated test fixture'}});
  const definition={physical:{schema:1,units:'m-kg-s-rad',gravity:[0,0,0],bodies:[body('part'),body('ball')],joints:[]}};
  const mechanism=path.join(root,'cad/mechanism.json');await fs.writeFile(mechanism,JSON.stringify(definition));
  const state=await api.openModel(vscode.Uri.file(source));
  const wait=async fn=>{const until=Date.now()+90000;while(Date.now()<until){const value=await fn();if(value)return value;await delay(100);}throw Error('Timed out: '+JSON.stringify(api.getDiagnostics()));};
  await wait(()=>api.getDiagnostics().find(d=>d.phase==='ready'));
  const command=(method,args={})=>api.request(root,'model.py',method,args);
  const readiness=await wait(async()=>{const r=await command('physics-status');if(r.components.some(c=>c.phase==='failed'))throw Error(JSON.stringify(r));return r.components.length===2&&r.components.every(c=>c.phase==='ready')&&r;});
  const camera={target:[2,3,4],distance:130,yaw:1.4,pitch:.8};await command('view',{camera});await command('selection',{ids:['part']});
  assert.equal((await command('physics')).ok,true);await delay(100);
  assert.equal((await command('state')).mode,'physics');
  // A changed CAD source replaces geometry in the existing panel and republishes
  // readiness. The whole scene resets stopped, including independent bodies.
  const independent=readiness.components.find(c=>c.bodies.includes('ball'));
  await fs.writeFile(source,py(45));
  await wait(async()=>{const r=await command('physics-status');return r.events.some(e=>e.type==='physics-outdated')&&r;});
  const after=await wait(async()=>{const r=await command('physics-status');if(r.components.some(c=>c.phase==='failed'))throw Error(JSON.stringify(r));return r.revision!==readiness.revision&&r.components.every(c=>c.phase==='ready')&&r;});
  assert.notEqual(after.components.find(c=>c.bodies.includes('ball')).jobId,independent.jobId);
  assert.equal(after.running,false);assert.equal(after.resetPolicy,'whole-scene-stopped');
  const view=await command('state');assert.deepEqual(view.camera,camera);assert.deepEqual(view.selection.selectedIds,['part']);assert.equal(api.getDiagnostics().length,1);
  const image=await command('capture',{width:320,height:240});assert.ok(image.image.startsWith('data:image/png;base64,'));
  // Exercise the packaged managed-pose adapter on this existing native CAD
  // scene. Synthetic poses qualify rendering/attachment, not Java robot code.
  await command('cad');
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0],worldHash='a'.repeat(64);
  await command('attach-simulation',{worldHash,revision:view.revision,nativeFrames:{part:identity},bodyIds:['part','ball'],bindings:{schema:1,worldHash,start:[0,0,0],fieldOrigin:[0,0,0],robot:{part:{body:'part',local:identity}},field:{}}});
  await state.panel.webview.postMessage({sceneEvent:{simulationState:{worldHash,runId:'fixture',state:{tick:7,time:.14,bodies:{part:{position:[0,0,.3],quaternion:[0,0,0,1]},ball:{position:[0,0,.5],quaternion:[0,0,0,1]}}}}}});
  await wait(async()=>{const r=await command('simulation-state');return r.tick===7&&r;});
  const managed=await command('simulation-capture',{bodies:['part'],width:320,height:240});assert.deepEqual(managed.instanceIds,['part']);assert.equal(managed.tick,7);
  await command('cad');const restored=await command('state');assert.deepEqual(restored.camera,camera);assert.deepEqual(restored.selection.selectedIds,['part']);
  // Recorded particle playback is explicitly paused on load and uses this canvas.
  const replay={schema:1,units:'SI',sourceRevision:view.revision,topology:{surfaceVertexCount:4,indices:[0,2,1,0,1,3,0,3,2,1,2,3]},bindings:{part:{body:'part',local:identity}},frames:[0,1].map(time=>({time,bodies:{part:{position:[0,0,.2],quaternion:[0,0,0,1]}},ball:{particles:[[0,0,.1],[.02,0,.1],[0,.02,.1],[0,0,.13-time*.01]]}})),acceptance:{passed:false}};
  const loaded=await command('replay',{action:'load',replay});assert.equal(loaded.loaded,true);assert.equal(loaded.running,false);
  await command('replay',{action:'seek',seconds:.5});const recorded=await command('capture',{ids:['replay/deformable-ball'],width:320,height:240});assert.ok(recorded.image.startsWith('data:image/png;base64,'));
  await command('replay',{action:'unload'});assert.deepEqual((await command('state')).camera,camera);
  // Pending validation requests do not occupy the serial CAD host queue.
  const waiting=command('physics-wait',{after:after.sequence,timeoutMs:600});const t=Date.now();await command('view',{camera:{...camera,yaw:1.1}});const viewMs=Date.now()-t;assert.ok(viewMs<550,`view blocked by readiness wait: ${viewMs}`);await waiting;
  // Authored compliant sphere -> native activation -> bounded particle stream -> GPU.
  // This installed test uses the actual compiler/host, not synthetic posted particles.
  const foam=definition.physical.bodies[1],naturalI=.4*foam.inertial.mass*.01*.01;
  foam.inertial.tensor=[naturalI,naturalI,naturalI,0,0,0];
  foam.compliance={frequencyHz:30,subdivisions:0,entryMargin:.03,exitMargin:.1,recoveryTolerance:.0001};
  definition.physical.complianceZones=[{body:'part',center:[0,0,.3],half:[1,1,1],lookahead:.03}];
  await fs.writeFile(mechanism,JSON.stringify(definition));
  await wait(async()=>{const r=await command('physics-status');if(r.error)throw Error(r.error);return r.components.length===1&&r.components[0].phase==='ready'&&r;});
  const beforeStream=(await command('state')).camera;
  const streamed=await command('physics-particles',{action:'enable',bodyIds:['ball'],maxHz:20});assert.equal(streamed.ok,true);
  assert.equal((await command('physics')).ok,true);
  const particles=await wait(async()=>{const r=await command('physics-particles',{action:'state'});if(r.error)throw Error(r.error);return r.enabled&&r.updates>=2&&r;});
  assert.ok(particles.lastTick>0);assert.deepEqual((await command('state')).camera,beforeStream);
  assert.ok((await command('capture',{width:320,height:240})).image.startsWith('data:image/png;base64,'));
  await command('cad');assert.equal((await command('physics-particles',{action:'state'})).enabled,false);
  definition.physical.bodies[0].inertial.mass=-1;await fs.writeFile(mechanism,JSON.stringify(definition));
  await wait(async()=>{const r=await command('physics-status');return r.error&&r;});const rejected=await command('physics');assert.equal(rejected.ok,false);assert.equal(rejected.pending,false);
  // Direct STEP previews use a synthetic cache entry but physical metadata
  // remains beside the actual STEP asset and can be added after opening it.
  api.closeAll();const stepDir=path.join(root,'step-fixture'),stepFile=path.join(stepDir,'block.step');await fs.mkdir(stepDir,{recursive:true});
  await require('node:util').promisify(require('node:child_process').execFile)(config.pythonPath,['-c','import cadquery as cq,sys; a=cq.Assembly(); a.add(cq.Workplane().box(10,10,10),name="block"); a.save(sys.argv[1])',stepFile]);
  const step=await api.openModel(vscode.Uri.file(stepFile));await wait(()=>{const d=api.getDiagnostics().find(d=>d.entry===step.entry);if(d?.phase==='error')throw Error(d.error);return d?.phase==='ready';});
  const mesh=await fs.readFile(path.join(root,config.buildDirectory,'cad-cache',step.entry,'scene.bin')),parts=JSON.parse(mesh.subarray(8,8+mesh.readUInt32LE(4))).map(p=>p.id);
  const stepBody=body('step-body');stepBody.parts=parts;
  await fs.writeFile(path.join(stepDir,'mechanism.json'),JSON.stringify({physical:{schema:1,units:'m-kg-s-rad',bodies:[stepBody],joints:[]}}));
  await wait(async()=>{const r=await api.request(root,step.entry,'physics-status');return r.components.length===1&&r.components[0].phase==='ready'&&r;});
  assert.equal((await api.request(root,step.entry,'physics')).ok,true);
  await fs.writeFile(reportFile,JSON.stringify({ok:true,editorVersion:vscode.version,unifiedScene:true,managedPoseAttachment:true,asyncNativeValidation:true,directStepPhysics:true,persistentCamera:true,wholeSceneResetStopped:true,recordedGpuReplay:true,liveNativeGpuParticles:true,liveParticleUpdates:particles.updates,concurrentViewMs:viewMs,invalidPhysicsBlocked:true}));
 }catch(error){await fs.writeFile(reportFile,JSON.stringify({ok:false,error:String(error.stack??error),diagnostics:api?.getDiagnostics()}));throw error;}
 finally{api?.closeAll();}
};
