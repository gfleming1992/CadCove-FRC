import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import os from 'node:os';
import {nativeExecutable} from './runtime-location.js';
import {launchMatch} from './match-session.js';
import {validateDriverInput} from './match-wire.js';
export function validateScenario(scenario,robots){
 if(scenario.schema!==1||!Number.isFinite(scenario.duration)||scenario.duration<=0||scenario.duration>600||!Array.isArray(scenario.phases)||!scenario.phases.length)throw Error('Expected scenario schema 1, duration in (0,600] seconds and phases');
 let before=-1;for(const phase of scenario.phases){
  if(!Number.isFinite(phase.at)||phase.at<0||phase.at<=before||phase.at>=scenario.duration||!phase.robots||typeof phase.robots!=='object'||Array.isArray(phase.robots))throw Error('Invalid scenario phase');before=phase.at;
  for(const [id,input]of Object.entries(phase.robots)){if(!robots.includes(id))throw Error('Unknown scenario robot '+id);if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['enabled','controllers'].includes(k)))throw Error('Invalid scenario controller input');validateDriverInput({type:'input',sequence:1,...input});}
 }
 if(scenario.phases[0].at!==0)throw Error('First phase must start at zero');return scenario;
}
export function summarizeTiming(samples,dtMs){
 if(!samples.length)throw Error('No benchmark samples');
 const stats=key=>{const values=samples.map(s=>s[key]).sort((a,b)=>a-b);return {meanMs:values.reduce((a,b)=>a+b,0)/values.length,p95Ms:values[Math.ceil(values.length*.95)-1],p99Ms:values[Math.ceil(values.length*.99)-1],maxMs:values.at(-1),overBudget:values.filter(v=>v>dtMs).length};};
 return {samples:samples.length,stepBudgetMs:dtMs,physics:stats('physicsMs'),exchange:stats('exchangeMs')};
}
export async function thermalState(){
 if(process.platform!=='darwin')return {state:null,reason:'Thermal telemetry unavailable on this platform'};
 const p=Bun.spawn(['osascript','-l','JavaScript','-e','ObjC.import("Foundation"); JSON.stringify({state:Number($.NSProcessInfo.processInfo.thermalState),lowPowerMode:Boolean($.NSProcessInfo.processInfo.isLowPowerModeEnabled)})'],{stdout:'pipe',stderr:'ignore'}),timer=setTimeout(()=>p.kill(),2000);
 try{const value=await new Response(p.stdout).text();if(await p.exited)throw Error();const result=JSON.parse(value);return {state:result.state,lowPowerMode:result.lowPowerMode};}catch{return {state:null,reason:'Thermal telemetry unavailable'};}finally{clearTimeout(timer);}
}
async function residentMemory(pids){
 if(process.platform==='win32')return null;
 const child=Bun.spawn(['ps','-o','rss=','-p',pids.join(',')],{stdout:'pipe',stderr:'ignore'}),timer=setTimeout(()=>child.kill(),1000);
 try{const values=(await new Response(child.stdout).text()).trim().split(/\s+/).map(Number);if(await child.exited||values.length!==pids.length||values.some(n=>!Number.isFinite(n)))return null;return values.reduce((a,b)=>a+b,0)*1024;}catch{return null;}finally{clearTimeout(timer);}
}
// Observed behavior, not an automatic playability verdict. Cheap per-tick
// summaries retain actual robot contacts without recording another full trace.
export function matchBehavior(robots){
 const previous=new Map(),inventory=new Map(),result={ticks:0,robotContactTicks:0,robotPairs:{},chassis:{},inventorySeen:{},minChassisSeparation:null,finite:true};
 return {result,observe(state){
  result.ticks++;const pairs=new Set();
  for(const pair of state.contacts??[]){
   const a=/^(r[0-5])\//.exec(pair[0])?.[1],b=/^(r[0-5])\//.exec(pair[1])?.[1];
   if(a&&b&&a!==b)pairs.add([a,b].sort().join(':'));
  }
  if(pairs.size)result.robotContactTicks++;
  for(const key of pairs){const p=result.robotPairs[key]??={ticks:0,firstTime:state.time,lastTime:state.time};p.ticks++;p.lastTime=state.time;}
  for(let i=0;i<robots.length;i++)for(let j=i+1;j<robots.length;j++){
   const a=state.bodies[robots[i].prefix+(robots[i].world?.gameplay?.chassis_body??'chassis')]?.position,b=state.bodies[robots[j].prefix+(robots[j].world?.gameplay?.chassis_body??'chassis')]?.position;
   if(a&&b){const distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(result.minChassisSeparation===null||distance<result.minChassisSeparation.distance)result.minChassisSeparation={distance,pair:[robots[i].id,robots[j].id],time:state.time};}
  }
  for(const r of robots){
   const status=r.id==='r0'?state.gameplay:state.robot_gameplay?.[r.id],seen=inventory.get(r.id)??new Set();inventory.set(r.id,seen);
   const ids=result.inventorySeen[r.id]??=[];for(const id of status?.carried??[])if(!seen.has(id)){seen.add(id);ids.push(id);}
   const b=state.bodies[r.prefix+(r.world?.gameplay?.chassis_body??'chassis')];if(!b){result.finite=false;continue;}
   if(![['position',3],['velocity',3],['quaternion',4]].every(([k,n])=>Array.isArray(b[k])&&b[k].length===n&&b[k].every(Number.isFinite))){result.finite=false;continue;}
   const c=result.chassis[r.id]??={pathMetres:0,maxSpeed:0,minZ:b.position[2],maxZ:b.position[2],minUpZ:1};
   const old=previous.get(r.id);if(old)c.pathMetres+=Math.hypot(...b.position.map((v,i)=>v-old[i]));previous.set(r.id,b.position);
   c.maxSpeed=Math.max(c.maxSpeed,Math.hypot(...b.velocity));c.minZ=Math.min(c.minZ,b.position[2]);c.maxZ=Math.max(c.maxZ,b.position[2]);c.minUpZ=Math.min(c.minUpZ,1-2*(b.quaternion[0]**2+b.quaternion[1]**2));
  }
 }};
}
export async function benchmarkMatch({config,scenario:scenarioFile,output,onEvent=()=>{},signal,launchSession=launchMatch}){
 const configFile=path.resolve(config),definition=JSON.parse(await readFile(configFile,'utf8')),match=JSON.parse(await readFile(path.resolve(path.dirname(configFile),definition.match),'utf8'));
 const behavior=matchBehavior(match.robots);
 const scenario=validateScenario(JSON.parse(await readFile(scenarioFile,'utf8')),match.robots.map(r=>r.id)),samples=[],trace=[],thermal=[],snapshots=[];
 let session,ownedOutput=false,measuring=false,nextThermal=0,sequence=0,measurementStart,initialTime;const stream=randomUUID(),report={schema:1,headless:true,rendering:false,duration:scenario.duration};
 try{
  const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
  const native=definition.nativeBinary?path.resolve(path.dirname(configFile),definition.nativeBinary):nativeExecutable();
  report.provenance={configSha256:await hash(configFile),matchSha256:await hash(path.resolve(path.dirname(configFile),definition.match)),scenarioSha256:await hash(scenarioFile),nativeSha256:await hash(native),platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,bun:Bun.version,rayonThreads:process.env.RAYON_NUM_THREADS||'4'};
  thermal.push({at:Date.now(),...await thermalState()});
  session=await launchSession(configFile,{output,headless:true,signal,onEvent,onStep:s=>{trace.push(s.input);if(measuring){samples.push({physicsMs:s.physicsMs,exchangeMs:s.exchangeMs});behavior.observe(s.snapshot);}}});
  report.stations=session.info?.stations??null;
  const begin=session.coordinator.snapshot;report.initial={tick:begin.tick,time:begin.time,bodies:begin.bodies};report.measuredInputStart=trace.length;
  // The trace includes startup ticks so it replays from the authored world.
  const start=performance.now(),maxWall=Math.max(60000,scenario.duration*30000);let lastSample=0,phaseIndex=0;
  measurementStart=start;initialTime=begin.time;measuring=true;
  while(session.coordinator.snapshot.time-begin.time<scenario.duration){
   signal?.throwIfAborted();if(session.closed||session.coordinator.failure)throw Error(session.coordinator.failure||'Match stopped');if(performance.now()-start>maxWall)throw Error('Benchmark wall-clock deadline exceeded');
   const state=session.coordinator.snapshot,time=state.time-begin.time;while(phaseIndex+1<scenario.phases.length&&scenario.phases[phaseIndex+1].at<=time)phaseIndex++;
   const phase=scenario.phases[phaseIndex];await Promise.all(match.robots.map(r=>{const input=phase.robots[r.id]??{enabled:false,controllers:[]};return session.sendControls(r.id,{mode:input.enabled?'teleop':'disabled',controllers:input.enabled?input.controllers:[],controlStream:stream,sequence:++sequence});}));
   if(performance.now()-lastSample>1000){lastSample=performance.now();snapshots.push({wallSeconds:(lastSample-start)/1000,time,tick:state.tick,residentBytes:await residentMemory(session.pids),robots:match.robots.map(r=>({id:r.id,position:state.bodies[r.prefix+(r.world.gameplay?.chassis_body??'chassis')]?.position,gameplay:r.id==='r0'?state.gameplay:state.robot_gameplay?.[r.id]}))});onEvent({type:'progress',...snapshots.at(-1)});}
   if(Date.now()>nextThermal){nextThermal=Date.now()+5000;thermal.push({at:Date.now(),...await thermalState()});}
   await Bun.sleep(20);
  }
  report.ok=true;
 }catch(error){ownedOutput=error.matchOutput===path.resolve(output);report.ok=false;report.error=String(error.stack);}
 finally{
  measuring=false;report.behavior=behavior.result;
  if(session){
   report.final=session.coordinator.snapshot;
   if(measurementStart!==undefined){report.wallSeconds=(performance.now()-measurementStart)/1000;report.simSeconds=report.final.time-initialTime;report.realTimeRatio=report.simSeconds/report.wallSeconds;report.completedScenario=report.simSeconds>=scenario.duration;if(samples.length)report.timing=summarizeTiming(samples,match.world.dt*1000);}
  }
  await session?.close();thermal.push({at:Date.now(),...await thermalState()});report.thermal=thermal;report.osReportedNominalThroughout=thermal.every(t=>t.state===0&&!t.lowPowerMode);report.thermalNote=report.osReportedNominalThroughout?'OS reported nominal thermal state at every sample; measured timings are not adjusted.':'Thermal state was elevated or unavailable; this run is not classified as unthrottled.';report.snapshots=snapshots;report.peakSampledResidentBytes=snapshots.reduce((peak,s)=>Math.max(peak,s.residentBytes??0),0)||null;report.memoryNote='Sum of sampled process RSS for coordinator, physics and robot programs; shared pages may be counted more than once. This is not total system memory or physical footprint.';
  if(session||ownedOutput){await writeFile(path.join(output,'benchmark.json'),JSON.stringify(report,null,2)+'\n');await writeFile(path.join(output,'measured-inputs.json'),JSON.stringify(trace));}
 }
 return report;
}
export async function matchBenchmarkCommand(options){
 if(!options.config||!options.scenario||!options.output)throw Error('match-benchmark requires --config, --scenario and --output');
 const abort=new AbortController(),stop=()=>abort.abort(Error('Benchmark stopped'));process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const report=await benchmarkMatch({...options,signal:abort.signal,onEvent:event=>console.log(JSON.stringify(event))});if(!report.ok)throw Error(report.error);return {ok:true,output:path.resolve(options.output),simSeconds:report.simSeconds,wallSeconds:report.wallSeconds,realTimeRatio:report.realTimeRatio,timing:report.timing,osReportedNominalThroughout:report.osReportedNominalThroughout};}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
