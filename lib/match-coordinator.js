import net from 'node:net';
import {requirePhysicsNumericsCapabilities} from './runtime-location.js';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

// One wall clock for the shared world. Correct timer jitter, but discard debt
// beyond one tick after overload; physics and robot steps are never skipped.
export class MatchPacing {
 constructor(periodMs){assert(Number.isFinite(periodMs)&&periodMs>0,'Invalid match tick period');this.period=periodMs;this.deadline=null;}
 afterStep(started,finished){
  this.deadline=(this.deadline??started)+this.period;
  if(finished-this.deadline>this.period)this.deadline=finished;
  return Math.max(0,this.deadline-finished);
 }
}

// Experimental local lockstep coordinator. A lost/stalled participant ends the
// match instead of advancing with stale actuator commands. No public listener.
export async function startMatch({binary,world,robots,log,onStep=()=>{},stepTimeout=30000,assetRoot}) {
 assert(robots.length>=2&&robots.length<=6&&robots.every((r,i)=>r.id==='r'+i&&r.prefix===r.id+'/'),'Expected 2–6 sequential robot slots');
 assert(Number.isFinite(stepTimeout)&&stepTimeout>0,'Invalid step deadline');
 const pacing=new MatchPacing((world.dt??.005)*1000);
 const child=Bun.spawn([binary],{cwd:assetRoot,stdin:'pipe',stdout:'pipe',stderr:log??'inherit',env:{...process.env,RAYON_NUM_THREADS:process.env.RAYON_NUM_THREADS||'4'}});
 const lines=createInterface({input:Readable.fromWeb(child.stdout)})[Symbol.asyncIterator]();
 let chain=Promise.resolve(),snapshot,closed=false,failure=null,inFlight=false,paceTimer,paceResolve;
 const cancelPacing=()=>{clearTimeout(paceTimer);paceResolve?.();paceResolve=null;};
 const token=randomBytes(32).toString('hex'),clients=new Map(),pending=new Map();
 function request(command){const p=chain.then(async()=>{
  child.stdin.write(JSON.stringify(command)+'\n');await child.stdin.flush();
  const line=await lines.next();if(line.done)throw Error('Shared physics process exited');
  const reply=JSON.parse(line.value);if(!reply.ok)throw Error(reply.error);
  if(reply.state)snapshot=reply.state;
  else if(reply.stateDelta){const d=reply.stateDelta;assert.equal(d.baseTick,snapshot.tick);const bodies={...snapshot.bodies,...d.state.bodies};for(const id of d.removedBodies)bodies[id]&&delete bodies[id];snapshot={...snapshot,...d.state,bodies};}
  return reply;
 });chain=p.catch(()=>{});return p;}
 try{
  if(world.solver_schedule!==undefined||world.max_contact_substeps!==undefined||world.local_cylinder_contacts!==undefined)requirePhysicsNumericsCapabilities(await request({op:'capabilities'}),world);
  await request({op:'load',world});
  assert(snapshot?.gameplay&&robots.slice(1).every(r=>snapshot.robot_gameplay?.[r.id]),'Native runtime lacks shared robot gameplay; rebuild the simulator');
 }catch(error){child.stdin.end();child.kill();await child.exited;throw error;}
 const config=new Map(robots.map(r=>[r.id,r]));
 const fieldMotors=new Set(Object.keys(world.field_drives||{}));
 function view(r,state){
  const map=(items)=>Object.fromEntries(Object.entries(items||{}).filter(([id])=>!/^r[0-5]\//.test(id)||id.startsWith(r.prefix)).map(([id,v])=>[id.startsWith(r.prefix)?id.slice(r.prefix.length):id,v]));
  return {...state,bodies:map(state.bodies),joints:map(state.joints),motors:map(state.motors),transmissions:map(state.transmissions),
   contacts:state.contacts.map(pair=>pair.map(id=>id.startsWith(r.prefix)?id.slice(r.prefix.length):id)),
   gameplay:r.id==='r0'?state.gameplay:state.robot_gameplay?.[r.id],robot_gameplay:undefined};
 }
 function replyState(client,reply,delta){
  const next=view(client.robot,snapshot),last=client.previous;client.previous=next;
  if(!delta||!last)return {...reply,state:next,stateDelta:undefined};
  // Native deltas retain the previous object for every unchanged body. Preserve
  // that identity through each robot view instead of reserializing the entire
  // field twice per body for every JVM on every tick. Full snapshots may send
  // extra unchanged records, which are safe and re-establish the base.
  const changed={};for(const [id,b] of Object.entries(next.bodies))if(b!==last.bodies[id])changed[id]=b;
  return {...reply,state:undefined,stateDelta:{baseTick:last.tick,removedBodies:Object.keys(last.bodies).filter(id=>!(id in next.bodies)),state:{...next,bodies:changed}}};
 }
 const send=(socket,value)=>socket.write(JSON.stringify(value)+'\n');
 function fail(error){if(closed||failure)return;failure=String(error);cancelPacing();for(const c of clients.values()){send(c.socket,{ok:false,error:failure});c.socket.end();}pending.clear();}
 async function step(){
  if(closed||failure||inFlight||pending.size!==robots.length)return;
  inFlight=true;const entries=[...pending.values()];pending.clear();
  try{
   const volts={...world.field_drives},coast=[];
   for(const {client,command} of entries){
    assert(command.steps===undefined||command.steps===1,'Only one shared tick per request');
    for(const [id,v] of Object.entries(command.volts||{})){
     if(fieldMotors.has(id)){assert.equal(v,world.field_drives[id]);continue;}
     assert(client.robot.motorIds.includes(id),'Unknown robot actuator');assert(Number.isFinite(v)&&Math.abs(v)<=16,'Invalid motor voltage');volts[client.robot.prefix+id]=v;
    }
    for(const id of command.coast||[]){assert(client.robot.motorIds.includes(id));coast.push(client.robot.prefix+id);}
   }
   const started=performance.now();const reply=await request({op:'step',volts,coast,state_delta:true});
   onStep({snapshot,input:{volts,coast},physicsMs:reply.physicsMs,performance:reply.performance,exchangeMs:performance.now()-started});
   const delay=pacing.afterStep(started,performance.now());
   if(delay>0)await new Promise(resolve=>{paceResolve=resolve;paceTimer=setTimeout(()=>{paceResolve=null;resolve();},delay);});
   if(closed||failure)return;
   for(const {client,command} of entries){send(client.socket,replyState(client,reply,command.state_delta));client.waiting=false;}
  }catch(e){fail(e);}finally{inFlight=false;}
 }
 const sockets=new Set();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.setNoDelay(true);let client=null,buffer='';
  socket.on('data',data=>{
   buffer+=data.toString();if(buffer.length>128*1024*1024){socket.destroy();return;}
   let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    (async()=>{
     const command=JSON.parse(line);
     if(!client){assert(command.op==='join'&&command.token===token&&config.has(command.robotId)&&!clients.has(command.robotId),'Invalid match participant');assert(command.coordinatorPacing===true,'Shared match requires coordinator pacing support; re-export and compile the robot bridge');client={robot:config.get(command.robotId),socket,waiting:false};clients.set(command.robotId,client);send(socket,{ok:true,pacing:'coordinator'});return;}
     assert(!client.waiting,'Participant sent overlapping requests');
     if(command.op==='load'){assert(!client.loaded,'Participant cannot reload the match');assert.deepEqual(command.world,client.robot.world,'Robot package changed');client.loaded=true;send(socket,replyState(client,{ok:true},false));}
     else if(command.op==='step'){assert(client.loaded);client.waiting=true;pending.set(client.robot.id,{client,command,at:performance.now()});await step();}
     else if(command.op==='sight_segments'){
      const mapped=structuredClone(command);for(const seg of mapped.segments)if(seg.ignore)seg.ignore=seg.ignore.map(id=>client.robot.bodyIds.includes(id)?client.robot.prefix+id:id);
      send(socket,await request(mapped));
     }else if(command.op==='state')send(socket,replyState(client,{ok:true},false));
     else throw Error('Unsupported operation in shared match: '+command.op);
    })().catch(error=>{if(client)fail(error);else{send(socket,{ok:false,error:commandError(error)});socket.end();}});
   }
  });
  socket.on('error',error=>{if(client)fail(error);});socket.on('close',()=>{sockets.delete(socket);if(client&&!closed)fail('Robot disconnected: '+client.robot.id);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const timer=setInterval(()=>{if([...pending.values()].some(p=>performance.now()-p.at>stepTimeout))fail('Robot missed shared-clock deadline');},1000);
 return {port:server.address().port,token,pid:child.pid,request,get snapshot(){return snapshot;},get failure(){return failure;},
  async close(){closed=true;clearInterval(timer);cancelPacing();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));child.stdin.end();child.kill();await child.exited;}};
}

function commandError(error){return error.message?.startsWith('Shared match requires coordinator pacing')?error.message:'Invalid match participant';}
