import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {startMatch} from './match-coordinator.js';
import {prepareMatchAssets} from './match-assets.js';
import {startMatchServer} from './match-server.js';
import {nativeExecutable} from './runtime-location.js';

export function matchStation(program){
 const station=program.station===undefined?'Blue1':program.station;
 if(!['Blue1','Blue2','Blue3','Red1','Red2','Red3'].includes(station))throw Error('Invalid robot station: '+station);
 return station;
}
// Commands are trusted, precompiled local robot programs, never client uploads.
export async function launchMatch(configFile,{output,hostname='127.0.0.1',port=0,onEvent=()=>{},onStep=()=>{},headless=false,signal}={}){
 const file=path.resolve(configFile),root=path.dirname(file),config=JSON.parse(await readFile(file,'utf8')),resolve=p=>path.resolve(root,p);
 if(config.schema!==1||typeof config.match!=='string'||(!headless&&!config.cad)||!Array.isArray(config.programs)||!output)throw Error('Expected match server schema 1, CAD assets, programs and a new output directory');
 const match=JSON.parse(await readFile(resolve(config.match),'utf8'));
 if(!Array.isArray(match.robots)||match.robots.length!==config.programs.length)throw Error('One precompiled program is required per robot');
 const ports=new Set();
 for(const [i,p]of config.programs.entries())if(p.robotId!==match.robots[i].id||!Array.isArray(p.command)||!p.command.length||!p.command.every(x=>typeof x==='string'&&x)||!Number.isInteger(p.bridgePort)||p.bridgePort<1024||p.bridgePort>65535||ports.has(p.bridgePort)||typeof p.cwd!=='string')throw Error('Invalid robot command, working directory or unique bridge port');else ports.add(p.bridgePort);
 for(const program of config.programs)matchStation(program);
 const destination=path.resolve(output);await mkdir(destination,{recursive:false});
 const children=[],bridges=new Map();let coordinator,web,monitor,finished=false,closePromise;
 const close=()=>closePromise??=(async()=>{
  clearInterval(monitor);await web?.close();
  for(const p of children)p.kill('SIGTERM');await coordinator?.close();
  await Promise.all(children.map(async p=>{await Promise.race([p.exited,Bun.sleep(2000)]);if(p.exitCode===null)p.kill('SIGKILL');await p.exited;}));finished=true;
 })();
 try{
  const binary=config.nativeBinary?resolve(config.nativeBinary):nativeExecutable(),assetRoot=resolve(config.assetRoot);
  coordinator=await startMatch({binary,...match,assetRoot,stepTimeout:60000,onStep,log:Bun.file(path.join(destination,'physics.log'))});
  // Build and hash assets before starting programs: preload cannot consume a
  // participant's startup deadline, and no CAD work occurs inside physics ticks.
  const assets=headless?null:await prepareMatchAssets(Object.fromEntries(Object.entries(config.cad).map(([k,v])=>[k,resolve(v)])),match.robots,Object.keys(coordinator.snapshot.bodies).sort());
  signal?.throwIfAborted();
  for(const [i,p]of config.programs.entries()){
   signal?.throwIfAborted();
   const robot=match.robots[i],build=path.join(destination,robot.id);await mkdir(build);const worldFile=path.join(build,'world.json');await writeFile(worldFile,JSON.stringify(robot.world));
   // Reject an already-running bridge instead of sending controls to it.
   const endpoint='http://127.0.0.1:'+p.bridgePort;
   try{await fetch(endpoint+'/state',{signal:AbortSignal.timeout(300)});throw Error('Bridge port is already in use: '+p.bridgePort);}catch(e){if(e.message.startsWith('Bridge port'))throw e;}
   const log=openSync(path.join(destination,robot.id+'.log'),'w');let proc;
   try{proc=Bun.spawn(p.command,{cwd:resolve(p.cwd),env:{...process.env,...p.env,HALSIM_EXTENSIONS:'',INSTANTCAD_SIM:'1',INSTANTCAD_ROOT:assetRoot,INSTANTCAD_BUILD:build,INSTANTCAD_WORLD:worldFile,INSTANTCAD_SIM_BINARY:binary,INSTANTCAD_CONTROL_SOURCE:'agent',INSTANTCAD_ALLIANCE_STATION:matchStation(p),INSTANTCAD_CLOCK:'physics',INSTANTCAD_ALLOW_RESET:'0',INSTANTCAD_BRIDGE_PORT:String(p.bridgePort),CADCOVE_MATCH_PORT:String(coordinator.port),CADCOVE_MATCH_ROBOT:robot.id,CADCOVE_MATCH_TOKEN:coordinator.token},stdout:log,stderr:log});}finally{closeSync(log);}
   children.push(proc);let state;
   for(let n=0;n<100;n++){
    signal?.throwIfAborted();
    if(proc.exitCode!==null)throw Error('Robot program exited: '+robot.id);
    try{const response=await fetch(endpoint+'/state',{signal:AbortSignal.timeout(500)});if(response.ok){const candidate=await response.json();if(candidate.state?.tick!==undefined&&!candidate.error){state=candidate;break;}}}catch{}
    await Bun.sleep(200);
   }
   if(!state?.runId)throw Error('Robot bridge did not initialize: '+robot.id);
   if(p.station!==undefined&&state.allianceStation!==p.station)throw Error('Robot bridge did not apply station '+p.station+' for '+robot.id+'; rebuild the robot with the current TwinBridge');
   bridges.set(robot.id,{endpoint,runId:state.runId,station:state.allianceStation??'unreported'});onEvent({type:'robot-ready',robotId:robot.id,pid:proc.pid,station:state.allianceStation??'unreported'});
  }
  if(coordinator.failure)throw Error(coordinator.failure);
  const sendControls=async(id,command)=>{
   const bridge=bridges.get(id),response=await fetch(bridge.endpoint+'/controls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...command,runId:bridge.runId}),signal:AbortSignal.timeout(750)});
   if(!response.ok)throw Error('Robot rejected controls');
  };
  signal?.throwIfAborted();
  if(!headless)web=await startMatchServer({coordinator,assets,sendControls,hostname,port,stateHz:config.stateHz??60,allowedOrigins:config.allowedOrigins??[]});
  signal?.throwIfAborted();
  const info={schema:1,session:web?.session,port:web?.port,hostname,urls:web?.urls,headless,robots:match.robots.map(r=>r.id),authority:'server',prediction:false,stations:Object.fromEntries([...bridges].map(([id,b])=>[id,b.station])),output:destination};
  await writeFile(path.join(destination,'session.json'),JSON.stringify(info,null,2)+'\n',{mode:0o600});
  monitor=setInterval(()=>{if(coordinator.failure||children.some(p=>p.exitCode!==null)){onEvent({type:'failed',message:coordinator.failure||'Robot program exited'});close();}},1000);
  return {info,coordinator,web,sendControls,pids:[process.pid,coordinator.pid,...children.map(p=>p.pid)],close,get closed(){return finished;}};
 }catch(e){await close();e.matchOutput=destination;throw e;}
}
export async function matchServeCommand(options){
 if(!options.config||!options.output)throw Error('match-serve requires --config and --output');
 const port=options.port===undefined?0:Number(options.port);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
 const abort=new AbortController();let session;
 const stop=()=>{abort.abort(Error('Match stopped'));session?.close();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  session=await launchMatch(options.config,{output:options.output,hostname:options.host??'127.0.0.1',port,signal:abort.signal,onEvent:event=>console.log(JSON.stringify(event))});
  if(abort.signal.aborted){await session.close();return;}
  console.log(JSON.stringify({type:'ready',...session.info}));
  await new Promise(resolve=>{const timer=setInterval(()=>{if(session.closed){clearInterval(timer);resolve();}},250);});
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await session?.close();}
}
