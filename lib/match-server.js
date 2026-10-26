import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {runtimeRoot,bundledRuntime} from './runtime-location.js';
import {encodePoses,projectPoses,validateDriverInput} from './match-wire.js';

export async function matchClientFiles(){
 if(bundledRuntime)return {html:await readFile(path.join(runtimeRoot,'match.html'),'utf8'),js:await readFile(path.join(runtimeRoot,'match-client.js'),'utf8')};
 const result=await Bun.build({entrypoints:[path.join(runtimeRoot,'web/match-client.js')],target:'browser',format:'esm',minify:true});
 if(!result.success)throw Error('Cannot build match client: '+result.logs.join('\n'));
 return {html:await readFile(path.join(runtimeRoot,'web/match.html'),'utf8'),js:await result.outputs[0].text()};
}

// This process handles only assets, inputs and state. Rendering runs in clients.
export async function startMatchServer({coordinator,assets,sendControls,hostname='127.0.0.1',port=0,stateHz=60,inputTimeoutMs=500,allowedOrigins=[],clientFiles}){
 if(!Number.isFinite(stateHz)||stateHz<1||stateHz>60||!Number.isFinite(inputTimeoutMs)||inputTimeoutMs<100||inputTimeoutMs>1000)throw Error('Invalid network cadence');
 const files=clientFiles??await matchClientFiles(),session=randomUUID(),tokens=new Map(),slots=new Map(),sockets=new Set(),bodyIds=assets.manifest.bodyIds;
 const makeToken=role=>{const token=randomBytes(32).toString('hex');tokens.set(token,role);return token;};
 const spectatorToken=makeToken({robotId:null}),driverTokens={};let stopped=false,sequence=0,published=null,keyframeAt=0;
 const stats={frames:0,poseBytes:0,droppedUpdates:0,inputs:0,poseEncodes:0,encodedPoseBytes:0};
 for(const r of assets.manifest.robots){slots.set(r.id,{owner:null,pending:null,pumping:null,sequence:0,enabled:false,lastInput:0,timedOut:false});driverTokens[r.id]=makeToken({robotId:r.id});}
 function controls(id,enabled,controllers=[]){
  const slot=slots.get(id);slot.enabled=enabled;slot.pending={mode:enabled?'teleop':'disabled',controllers:enabled?controllers:[],controlStream:session,sequence:++slot.sequence};
  pump(id,slot);
 }
 function pump(id,slot){
  if(!slot.pumping)slot.pumping=(async()=>{while(slot.pending){const command=slot.pending;slot.pending=null;try{await sendControls(id,command);}catch{slot.enabled=false;slot.owner?.send(JSON.stringify({type:'error',message:'Robot controls unavailable'}));slot.owner?.close(1011,'Controls unavailable');}}})().finally(()=>{slot.pumping=null;if(slot.pending)pump(id,slot);});
 }
 function release(ws){const slot=slots.get(ws.data.role?.robotId);if(slot?.owner===ws){slot.owner=null;controls(ws.data.role.robotId,false);}}
 function json(ws,value){ws.send(JSON.stringify(value));}
 function broadcast(){
  if(stopped)return;const snapshot=coordinator.snapshot,now=performance.now();
  for(const [id,s]of slots)if(s.enabled&&(now-s.lastInput>inputTimeoutMs||coordinator.failure)){s.timedOut=true;controls(id,false);if(s.owner)json(s.owner,{type:'disabled',reason:coordinator.failure?'Simulation failed':'Input timed out'});}
  for(const ws of sockets)if(!ws.data.role&&now-ws.data.opened>5000)ws.close(1008,'Authentication required');
  const clients=[...sockets].filter(ws=>ws.data.ready);
  if(clients.some(ws=>ws.data.lastTick!==snapshot.tick)){
   const current={poses:projectPoses(snapshot,bodyIds),tick:snapshot.tick,time:snapshot.time},previous=published;
   sequence=sequence===0xffffffff?1:sequence+1;
   const forceFull=!previous||sequence===1||now-keyframeAt>2000;
   if(forceFull)keyframeAt=now;
   published={...current,sequence};let fullBytes,deltaBytes;
   const encode=base=>{const bytes=encodePoses(current,base,sequence);stats.poseEncodes++;stats.encodedPoseBytes+=bytes.byteLength;return bytes;};
   // One shared delta for the current scene. A client missing that base gets
   // the shared keyframe; neither a slow client nor a new join delays peers.
   // Include current-tick peers on resync/join so everyone advances to the
   // same sequence, even when the simulation is paused.
   for(const ws of clients){
    if(ws.getBufferedAmount()>64*1024){stats.droppedUpdates++;if(now-ws.data.sentAt>1000)ws.close(1013,'Viewer too slow; reconnect');continue;}
    const full=forceFull||!ws.data.previous||ws.data.previous.sequence!==previous.sequence;
    const bytes=full?(fullBytes??=encode(null)):(deltaBytes??=encode(previous)),result=ws.send(bytes);
    if(result===0){ws.data.previous=null;continue;}
    ws.data.previous=published;ws.data.lastTick=snapshot.tick;ws.data.sentAt=now;if(full)ws.data.keyframeAt=now;stats.frames++;stats.poseBytes+=bytes.byteLength;
   }
  }
  for(const ws of sockets)if(ws.data.ready&&now-ws.data.statusAt>1000){json(ws,{type:'status',tick:snapshot.tick,time:snapshot.time,failed:Boolean(coordinator.failure),gameplay:snapshot.gameplay,robotGameplay:snapshot.robot_gameplay});ws.data.statusAt=now;}
 }
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const server=Bun.serve({hostname,port,maxRequestBodySize:16384,async fetch(req,server){
  const url=new URL(req.url),origin=req.headers.get('origin');
  if(origin&&origin!==url.origin&&!allowedOrigins.includes(origin))return new Response('Untrusted origin',{status:403,headers});
  if(req.method!=='GET')return new Response('Method not allowed',{status:405,headers});
  if(url.pathname==='/socket'){
   if(sockets.size>=32)return new Response('Too many viewers',{status:503,headers});
   return server.upgrade(req,{data:{opened:performance.now(),role:null,ready:false,previous:null,lastTick:-1,keyframeAt:0,statusAt:0,sentAt:performance.now(),inputSequence:0,rateStart:performance.now(),rate:0}})?undefined:new Response('Upgrade required',{status:426,headers});
  }
  if(url.pathname==='/')return new Response(files.html,{headers:{...headers,'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
  if(url.pathname==='/match-client.js')return new Response(files.js,{headers:{...headers,'Content-Type':'text/javascript'}});
  const role=tokens.get(req.headers.get('authorization')?.replace(/^Bearer /,''));if(!role)return new Response('Unauthorized',{status:401,headers});
  if(url.pathname==='/manifest')return Response.json({...assets.manifest,session,robotId:role.robotId,stateHz},{headers});
  const prefix=assets.manifest.assetRoot+'/';
  if(url.pathname.startsWith(prefix))try{
   const key=decodeURIComponent(url.pathname.slice(prefix.length)),bytes=await assets.read(key);if(!bytes)return new Response('Not found',{status:404,headers});
   return new Response(bytes,{headers:{...headers,'Content-Type':key.endsWith('.json')?'application/json':'application/octet-stream','Cache-Control':'private, max-age=31536000, immutable'}});
  }catch{return new Response('Asset revision unavailable',{status:409,headers});}
  return new Response('Not found',{status:404,headers});
 },websocket:{maxPayloadLength:16384,backpressureLimit:256*1024,closeOnBackpressureLimit:true,
  open(ws){sockets.add(ws);},close(ws){sockets.delete(ws);release(ws);},
  message(ws,data){try{
   if(typeof data!=='string')throw Error('Expected input JSON');const m=JSON.parse(data),now=performance.now();
   if(!ws.data.role){const role=tokens.get(m.token);if(m.type!=='hello'||!role||m.revision!==assets.manifest.revision||m.session!==session)throw Error('Invalid match or credentials');
    const slot=slots.get(role.robotId);if(slot?.owner)throw Error('Robot already has a driver');ws.data.role=role;ws.data.ready=true;if(slot){slot.owner=ws;slot.timedOut=false;controls(role.robotId,false);}
    json(ws,{type:'welcome',session,robotId:role.robotId,prediction:false});broadcast();return;
   }
   if(now-ws.data.rateStart>1000){ws.data.rateStart=now;ws.data.rate=0;}if(++ws.data.rate>90)throw Error('Input rate exceeded');
   if(m.type==='ping'){json(ws,{type:'pong',sent:m.sent});return;}
   if(m.type==='resync'){ws.data.previous=null;ws.data.lastTick=-1;ws.data.keyframeAt=0;broadcast();return;}
   validateDriverInput(m);const id=ws.data.role.robotId,slot=slots.get(id);
   if(!id||slot.owner!==ws)throw Error('This connection cannot drive');if(m.sequence<=ws.data.inputSequence)return;
   ws.data.inputSequence=m.sequence;if(slot.timedOut&&m.enabled)return;if(!m.enabled)slot.timedOut=false;slot.lastInput=now;stats.inputs++;
   if(coordinator.failure&&m.enabled)throw Error('Simulation failed');controls(id,m.enabled,m.controllers);
  }catch(e){json(ws,{type:'error',message:e.message});release(ws);ws.close(1008,'Invalid request');}}
 }});
 const timer=setInterval(()=>{try{broadcast();}catch{for(const ws of sockets){release(ws);ws.close(1011,'State unavailable');}}},1000/stateHz);
 const base='http://'+(hostname==='0.0.0.0'?'127.0.0.1':hostname)+':'+server.port;
 return {port:server.port,session,stats,driverTokens,spectatorToken,urls:{spectator:base+'/#token='+spectatorToken,drivers:Object.fromEntries(Object.entries(driverTokens).map(([id,t])=>[id,base+'/#token='+t]))},
  async close(){if(stopped)return;stopped=true;clearInterval(timer);for(const ws of sockets){release(ws);ws.close(1001,'Match stopped');}for(const [id]of slots)controls(id,false);while([...slots.values()].some(s=>s.pumping))await Promise.all([...slots.values()].map(s=>s.pumping));server.stop(true);}};
}
