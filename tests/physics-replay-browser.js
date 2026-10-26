// Optional real-asset integration runner. Inputs stay outside shipped source.
// bun tests/physics-replay-browser.js --scene /absolute/scene.bin --replay /absolute/replay.json --output /absolute/results
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,i,all)=>i%2?pairs:[...pairs,[value.replace(/^--/,''),all[i+1]]],[]));
for(const key of ['scene','replay','output'])if(!args[key]||!path.isAbsolute(args[key]))throw Error('Supply absolute --scene, --replay and --output paths');
await fs.mkdir(args.output,{recursive:true});
const sceneBytes=await Bun.file(args.scene).arrayBuffer(),record=await Bun.file(args.replay).json(),sceneHash=new Bun.CryptoHasher('sha256').update(sceneBytes).digest('hex');
if(record.sourceSceneHash)assert.equal(sceneHash,record.sourceSceneHash,'Replay must match actual CAD scene bytes');
const root=process.cwd(),server=Bun.serve({port:0,idleTimeout:120,fetch(request){const p=new URL(request.url).pathname;if(p==='/scene.bin')return new Response(sceneBytes);if(p==='/replay.json')return Response.json(record);if(['/web/','/lib/','/vendor/cad-core/src/core/'].some(prefix=>p.startsWith(prefix))&&!p.includes('..'))return new Response(Bun.file(path.join(root,p)),{headers:{'content-type':'text/javascript'}});return new Response('<style>body{margin:0;background:#0c1118;color:#eee;font:16px system-ui}#label{height:55px;padding:12px 24px;box-sizing:border-box}canvas{width:1200px;height:745px;display:block}</style><div id="label">Recorded physics inspection — loading</div><canvas></canvas>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
let context;
try{
 context=await browser.newContext({viewport:{width:1200,height:800},recordVideo:{dir:args.output,size:{width:1200,height:800}}});const page=await context.newPage();await page.goto(`http://localhost:${server.port}`);
 const setup=await page.evaluate(async()=>{
  const {AssemblyViewer}=await import('/vendor/cad-core/src/core/assembly-viewer.js'),{decodeScene}=await import('/vendor/cad-core/src/core/mesh.js'),{installPhysicsReplay}=await import('/web/scene-replay.js');
  const record=await (await fetch('/replay.json')).json(),scene=decodeScene(await (await fetch('/scene.bin')).arrayBuffer()),parts=scene.parts.filter(p=>record.bindings[p.id]),identity=[1,0,0,0,0,1,0,0,0,0,1,0],viewer=await new AssemblyViewer(document.querySelector('canvas')).init(),errors=[];
  viewer.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  viewer.setAssembly({prototypes:parts,instances:parts.map(p=>({id:p.id,asset:p.id,color:p.color,transform:identity}))});
  const replay=installPhysicsReplay({viewer,motion:{stop(){}},revision:()=>record.sourceRevision,placement:()=>identity});const ingestStart=performance.now();await replay.load(record);const ingestMs=performance.now()-ingestStart;
  const translucent=[];for(const p of parts){const body=record.bindings[p.id].body;if(!['chassis','turret/left','hood/left'].includes(body))continue;const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(let i=0;i<p.positions.length;i++) {const k=i%3;low[k]=Math.min(low[k],p.positions[i]);high[k]=Math.max(high[k],p.positions[i]);}const spans=high.map((n,k)=>n-low[k]).sort((a,b)=>a-b);if(spans[0]<15&&spans[1]>100){viewer.setOpacity({[p.id]:.18});translucent.push({id:p.id,name:p.name,body});}}
  const measurements=record.frames.map(f=>{const points=f.ball.particles.slice(0,record.topology.surfaceVertexCount),low=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),high=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))),span=high.map((n,k)=>n-low[k]);return {time:f.time,spanMm:span.map(n=>n*1000),minimumSpanMm:Math.min(...span)*1000,centerMm:low.map((n,k)=>(n+high[k])*500),representation:f.ball.representation,derivedFromRigidPose:f.ball.particlesDerivedFromRigidPose};});
  const peak=measurements.reduce((a,b)=>b.minimumSpanMm<a.minimumSpanMm?b:a),overview=(await viewer.captureView({ids:[...viewer.instanceLookup.keys()],view:'iso',width:1200,height:745})).camera;
  viewer.camera=overview;const buffers=[viewer.assemblyVertices,viewer.assemblyIndices,viewer.assemblyInstances],camera=JSON.stringify(viewer.camera);
  const verdict=record.acceptance?.physicalPredictionQualified?'RECORDED PHYSICS — prediction qualified':record.acceptance?.presentationDemoPassed?'ILLUSTRATIVE RECORDED DEMO — physical prediction UNQUALIFIED':'FAILED PHYSICS EXPERIMENT — no verified exit';
  window.fixture={viewer,replay,record,errors,buffers,camera,overview,measurements,peak,translucent,verdict};
  return {ingestMs,parts:parts.length,boundParts:Object.keys(record.bindings).length,acceptance:record.acceptance,scope:record.scope,peak,first:measurements[0],last:measurements.at(-1),translucent};
 });
 assert.equal(setup.parts,setup.boundParts);
 async function shot(name,which,detail=false,yaw=1.3){
  const result=await page.evaluate(async({which,detail,yaw})=>{const f=window.fixture,m=typeof which==='number'?f.measurements.reduce((a,b)=>Math.abs(b.time-which)<Math.abs(a.time-which)?b:a):which==='first'?f.measurements[0]:which==='peak'?f.peak:f.measurements.at(-1);f.replay.command({action:'seek',seconds:m.time});const camera=detail?{target:m.centerMm,distance:430,yaw,pitch:1.32}:f.overview;f.viewer.camera={...camera,target:[...camera.target]};f.viewer.request();const image=await f.viewer.captureView({ids:[...f.viewer.instanceLookup.keys()],camera,width:1200,height:745});document.querySelector('#label').textContent=`${f.verdict} | t=${m.time.toFixed(3)} s | ${detail?'Compression detail':'Connected shooter and feeder'} | thin supports translucent`;return {image:image.image,time:m.time,measurement:m};},{which,detail,yaw});
  await fs.writeFile(path.join(args.output,name+'-raw.png'),Buffer.from(result.image.split(',')[1],'base64'));await page.screenshot({path:path.join(args.output,name+'.png')});delete result.image;return {name,...result};
 }
 const shots=[];shots.push(await shot('01-entry','first'));shots.push(await shot('02-compression','peak',true));if(Number.isFinite(record.acceptance?.contactFreeFlightTime))shots.push(await shot('03-contact-free-flight',record.acceptance.contactFreeFlightTime));else shots.push(await shot('03-last-frame-no-verified-exit','last'));shots.push(await shot('04-last-detail','last',true));shots.push(await shot('05-compression-opposite','peak',true,-1.3));
 const playback=await page.evaluate(async()=>{
  const f=window.fixture;f.viewer.camera={...f.overview,target:[...f.overview.target]};const camera=JSON.stringify(f.viewer.camera);f.replay.command({action:'seek',seconds:f.measurements[0].time});f.replay.command({action:'play',speed:.1});document.querySelector('#label').textContent=f.verdict+' | recorded motion at 0.1× speed | thin supports translucent';
  const costs=[],intervals=[];let prior=null;await new Promise(resolve=>{const step=now=>{if(prior!==null)intervals.push(now-prior);prior=now;const t=performance.now();f.replay.tick(now);costs.push(performance.now()-t);if(f.replay.state().running)requestAnimationFrame(step);else resolve();};requestAnimationFrame(step);});
  await f.viewer.device.queue.onSubmittedWorkDone();const sorted=[...costs].sort((a,b)=>a-b),sortedIntervals=[...intervals].sort((a,b)=>a-b);
  return {displayUpdates:costs.length,updateCpuMeanMs:costs.reduce((a,b)=>a+b,0)/costs.length,updateCpuP95Ms:sorted[Math.floor(sorted.length*.95)],displayIntervalMedianMs:sortedIntervals[Math.floor(sortedIntervals.length*.5)],displayIntervalP95Ms:sortedIntervals[Math.floor(sortedIntervals.length*.95)],cameraUnchanged:camera===JSON.stringify(f.viewer.camera),buffersUnchanged:f.buffers.every((b,i)=>b===[f.viewer.assemblyVertices,f.viewer.assemblyIndices,f.viewer.assemblyInstances][i]),errors:f.errors,state:f.replay.state()};
 });
 assert.equal(playback.cameraUnchanged,true);assert.equal(playback.buffersUnchanged,true);assert.deepEqual(playback.errors,[]);assert.equal(playback.state.error,null);assert.equal(playback.state.running,false);
 const report={schema:1,scope:'Real CAD and recorded particle rendering verification; does not establish successful shooting or physical calibration',sceneHash,replaySourceRevision:record.sourceRevision,setup,shots,playback};await fs.writeFile(path.join(args.output,'report.json'),JSON.stringify(report,null,2));
 const video=page.video();await context.close();context=null;await video.saveAs(path.join(args.output,record.acceptance?.presentationDemoPassed?'illustrative-replay-slow.webm':'failed-physics-replay-slow.webm'));
 console.log(JSON.stringify({ok:true,output:args.output,acceptance:record.acceptance,setup:{ingestMs:setup.ingestMs,parts:setup.parts,peak:setup.peak},playback}));
}finally{await context?.close();await browser.close();server.stop(true);}
