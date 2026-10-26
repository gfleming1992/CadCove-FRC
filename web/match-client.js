import {MatchViewer} from './match-viewer.js';
import {loadAssembly,bindSimulationScene,gpuMatrix,poseTransforms,digest} from './simulation-scene.js';
import {AuthoritativePoses} from '../lib/match-wire.js';
import {xbox,keyboard} from './practice-input.js';
const $=id=>document.getElementById(id),status=$('status'),keys=new Set();
let viewer,socket,manifest,poses,instances,enabled=false,ready=false,sequence=0,lastArrival=0,rtt=0,reconnectTimer,reconnectAttempt=0,serverFailed=false,driverPadSeen=false;
const say=(message,error=false)=>{status.textContent=message;status.dataset.error=String(error);};
const token=new URLSearchParams(location.hash.slice(1)).get('token');
// Fragments are not sent in HTTP requests; keep the join token out of referrers.
const send=value=>{if(socket?.readyState!==WebSocket.OPEN)return false;if(socket.bufferedAmount>16384){socket.close(1013,'Input connection congested');return false;}socket.send(JSON.stringify(value));return true;};
function disable(reason='Robot disabled'){
 enabled=false;keys.clear();if(manifest?.robotId)send({type:'input',sequence:++sequence,enabled:false,controllers:[]});$('disable').disabled=true;$('enable').disabled=!ready||!manifest?.robotId||serverFailed;say(reason);
}
function updateView(focus=false){
 if(!poses?.bodies)return;const id=$('view').value,b=poses.bodies[id+'/chassis'];
 if(id==='field'){if(focus){viewer.camera.yaw=Math.PI/2;viewer.camera.pitch=1.1;viewer.fit();}return;}
 if(b&&(focus||$('follow').checked)){viewer.camera.target=[b.position[0],b.position[1],.4];if(focus){viewer.camera.distance=5.5;viewer.camera.pitch=1.1;viewer.camera.yaw=b.quaternion[2]>.5?0:Math.PI;}viewer.request();}
}
$('view').onchange=()=>updateView(true);$('follow').onchange=()=>updateView();
$('enable').onclick=()=>{if(!ready||!manifest.robotId||serverFailed)return;enabled=true;driverPadSeen=Boolean(navigator.getGamepads?.()[0]);$('enable').disabled=true;$('disable').disabled=false;say('Robot enabled');};
$('disable').onclick=()=>disable();
window.addEventListener('keydown',e=>{if(['INPUT','SELECT'].includes(e.target.tagName))return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyF','KeyR','Space','ShiftLeft','ShiftRight'].includes(e.code)){keys.add(e.code);e.preventDefault();}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{if(enabled)disable('Window lost focus — robot disabled');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&enabled)disable('Tab hidden — robot disabled');if(!document.hidden)viewer?.request();});
$('quality').onchange=()=>viewer?.setQuality($('quality').value);
window.addEventListener('pagehide',()=>{clearTimeout(reconnectTimer);if(manifest?.robotId)disable();socket?.close();viewer?.device.destroy();});
setInterval(()=>{
 if(!enabled||!ready)return;const pads=navigator.getGamepads?.()||[];
 if(driverPadSeen&&!pads[0]){disable('Driver controller disconnected');return;}driverPadSeen||=Boolean(pads[0]);
 const driver=pads[0]?xbox(pads[0],1):keyboard(keys),operator=pads[1]?xbox(pads[1],0):{port:0,axes:[0,0,0,keys.has('Space')?1:0,0,0],buttons:(keys.has('KeyF')?2:0)|(keys.has('KeyR')?1:0),pov:-1};
 send({type:'input',sequence:++sequence,enabled:true,controllers:[driver,operator]});
},20);
setInterval(()=>{
 if(socket?.readyState===WebSocket.OPEN)send({type:'ping',sent:performance.now()});
 if(lastArrival)$('metrics').textContent=`Tick ${poses.tick} · RTT ${Math.round(rtt)} ms · Last state ${Math.round(performance.now()-lastArrival)} ms ago · ${viewer.canvas.width}×${viewer.canvas.height}`;
},1000);

async function preload(){
 if(!token)throw Error('Open the spectator or driver link supplied by the match server');
 const response=await fetch('/manifest',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!response.ok)throw Error('Match link is invalid or has expired');manifest=await response.json();
 if(manifest.schema!==1||manifest.authority!=='server'||manifest.prediction!==false||manifest.interpolation!==false)throw Error('Unsupported match protocol');
 poses=new AuthoritativePoses(manifest.bodyIds);let loaded=0;const total=Object.keys(manifest.files).length,store=await caches.open('cadcove-match-assets-v1').catch(()=>null);
 const fetcher=async url=>{
  const key=url.slice((manifest.assetRoot+'/').length),descriptor=manifest.files[key];if(!descriptor)return new Response('',{status:404});
  const requestURL=new URL(url,location.href).href;let cached=await store?.match(requestURL),bytes=cached&&await cached.arrayBuffer();
  if(!bytes||await digest(bytes)!==descriptor.sha256){const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw Error('Asset unavailable: '+key);bytes=await response.arrayBuffer();if(bytes.byteLength!==descriptor.bytes||await digest(bytes)!==descriptor.sha256)throw Error('Asset integrity mismatch: '+key);await store?.put(requestURL,new Response(bytes)).catch(()=>{});}
  say(`Preloading game assets ${++loaded}/${total}`);return new Response(bytes);
 };
 const cache=new Map(),[robot,field]=await Promise.all([loadAssembly('robot',manifest.assetRoot+'/robot',{cache,fetcher,includeLods:true}),loadAssembly('field',manifest.assetRoot+'/field',{cache,fetcher,includeLods:true})]);
 bindSimulationScene(robot,field,manifest.bindings);
 instances=[...field.instances,...manifest.robots.flatMap(r=>robot.instances.map(n=>({...n,id:r.prefix+n.id,body:r.prefix+n.body})))].map(n=>({...n,transform:gpuMatrix(n.matrix)}));
 const known=new Set(manifest.bodyIds);for(const n of instances)if(n.body&&!known.has(n.body))throw Error('Unknown visual body '+n.body);
 viewer=await new MatchViewer(document.querySelector('canvas')).init();
 viewer.onRenderError=error=>{disable('Rendering stopped');say(error.message,true);socket?.close(1011,'Rendering stopped');};
 viewer.matchDefinition={prototypes:[...robot.prototypes,...field.prototypes],instances};
 for(const r of manifest.robots){const option=document.createElement('option');option.value=r.id;option.textContent=r.id;$('view').append(option);}
 $('role').textContent=manifest.robotId?'Driver · '+manifest.robotId:'Spectator';if(manifest.robotId){$('view').value=manifest.robotId;$('follow').checked=true;}
 connect();
}
function connect(){
 ready=false;enabled=false;sequence=0;poses.reset();$('enable').disabled=true;$('disable').disabled=true;
 socket=new WebSocket(new URL('/socket',location.href).href.replace(/^http/,'ws'));socket.binaryType='arraybuffer';
 socket.onopen=()=>socket.send(JSON.stringify({type:'hello',token,revision:manifest.revision,session:manifest.session}));
 socket.onmessage=event=>{
  try{
   if(typeof event.data==='string'){
    const m=JSON.parse(event.data);
    if(m.type==='welcome'){reconnectAttempt=0;say('Connected — waiting for authoritative state');}
    else if(m.type==='pong')rtt=performance.now()-m.sent;
    else if(m.type==='disabled')disable(m.reason);
    else if(m.type==='error'){say(m.message,true);serverFailed=true;}
    else if(m.type==='status'){serverFailed=m.failed;$('enable').disabled=enabled||!ready||!manifest.robotId||serverFailed;if(m.failed){disable('Server physics stopped');say('Server physics stopped',true);}}
    return;
   }
   const state=poses.accept(event.data);lastArrival=performance.now();
   if(!ready){const first=!viewer.instanceLookup;if(first){const changes=poseTransforms(instances,state);for(const n of instances)n.transform=changes[n.id]||n.transform;viewer.setAssembly(viewer.matchDefinition,true);}viewer.setBodyPoses(state.bodies);ready=true;updateView(first);$('enable').disabled=!manifest.robotId||serverFailed;say('Connected — '+(manifest.robotId?'robot disabled':'spectating'));}
   else {viewer.setBodyPoses(state.bodies);updateView();}
  }catch(error){disable('State unavailable');say(error.message,true);socket.close(1002,'Invalid state');}
 };
 socket.onclose=event=>{ready=false;enabled=false;keys.clear();$('enable').disabled=true;$('disable').disabled=true;say('Disconnected — robot disabled; last server pose held',true);if(event.code!==1008)reconnectTimer=setTimeout(connect,Math.min(5000,500*2**reconnectAttempt++));};
}
// Readable diagnostics for browser integration checks; no local physics API.
window.cadcoveMatch={get viewer(){return viewer;},get state(){return poses;},get manifest(){return manifest;},get ready(){return ready;},get enabled(){return enabled;}};
preload().catch(error=>say(error.message,true));
