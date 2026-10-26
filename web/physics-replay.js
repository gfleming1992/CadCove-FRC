import {compose,quaternionMatrix} from '../lib/transforms.js';
import {interpolatePose} from './live-motion.js';
import {checkedTopology} from './deformation-data.js';
const vec=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
// Recorded authoritative simulation samples. Playback never advances physics,
// changes feed forces, or turns a failed experiment into a passing one.
export function validatePhysicsReplay(value,revision,occurrences){
 if(!value||value.schema!==1||!['SI','m-s'].includes(value.units)||value.sourceRevision!==revision)throw Error('Replay requires current CAD revision and SI units');
 if(!Array.isArray(value.frames)||value.frames.length<2||value.frames.length>60000)throw Error('Replay needs 2–60000 recorded frames');
 let t=value.topology;
 if(Array.isArray(t?.indices)&&t.indices.some(Array.isArray)){
  if(!t.indices.every(triangle=>Array.isArray(triangle)&&triangle.length===3))throw Error('Invalid replay triangle tuples');
  t={...t,indices:t.indices.flat()};value={...value,topology:t};
 }
 if(!t||!Number.isInteger(t.surfaceVertexCount)||t.surfaceVertexCount<4||t.surfaceVertexCount>10000||!Array.isArray(t.indices)||!t.indices.length||t.indices.length%3||t.indices.length>300000||t.indices.some(i=>!Number.isInteger(i)||i<0||i>=t.surfaceVertexCount))throw Error('Invalid replay surface topology');
 const topology=checkedTopology(t);
 if(!value.bindings||typeof value.bindings!=='object'||Array.isArray(value.bindings))throw Error('Replay CAD bindings required');
 for(const [id,b]of Object.entries(value.bindings)){if(!occurrences.has(id)||!b||typeof b.body!=='string'||!vec(b.local,12))throw Error('Unknown or invalid replay CAD binding '+id);}
 let last=-Infinity;
 for(const f of value.frames){
  if(!Number.isFinite(f.time)||f.time<0||f.time<=last)throw Error('Replay times must increase');last=f.time;
  if(!f.bodies||!f.ball||!Array.isArray(f.ball.particles)||f.ball.particles.length!==topology.particleCount||!f.ball.particles.every(p=>vec(p,3)))throw Error('Replay requires finite recorded particle positions');
  for(const b of Object.values(value.bindings)){const p=f.bodies[b.body];if(!p||!vec(p.position,3)||!vec(p.quaternion,4)||Math.abs(Math.hypot(...p.quaternion)-1)>1e-3)throw Error('Missing or invalid recorded rigid body '+b.body);}
 }
 return value;
}
export function replaySample(replay,time){
 const fs=replay.frames,t=Math.max(fs[0].time,Math.min(fs.at(-1).time,time));let lo=0,hi=fs.length-1;
 while(lo+1<hi){const mid=(lo+hi)>>1;if(fs[mid].time<=t)lo=mid;else hi=mid;}
 return {a:fs[lo],b:fs[hi],alpha:(t-fs[lo].time)/(fs[hi].time-fs[lo].time),time:t,index:lo};
}
export function replayTransforms(replay,sample,placement){
 const poses=new Map(),changes={};
 for(const [id,b]of Object.entries(replay.bindings)){
  if(!poses.has(b.body)){const p=interpolatePose(sample.a.bodies[b.body],sample.b.bodies[b.body],sample.alpha);poses.set(b.body,quaternionMatrix(p.quaternion,p.position));}
  const m=compose(poses.get(b.body),b.local).map((v,i)=>i%4===3?v*1000:v);changes[id]=compose(placement,m);
 }
 return changes;
}
export class ReplayClock{
 constructor(replay){this.first=replay.frames[0].time;this.last=replay.frames.at(-1).time;this.time=this.first;this.speed=1;this.running=false;this.at=null;}
 tick(now){if(this.running&&this.at!==null){this.time=Math.min(this.last,this.time+(now-this.at)*.001*this.speed);if(this.time>=this.last)this.running=false;}this.at=now;return this.time;}
 command(args,now){this.tick(now);switch(args.action){
 case 'play':if(args.speed!==undefined){if(!Number.isFinite(args.speed)||args.speed<.01||args.speed>4)throw Error('Replay speed must be 0.01–4');this.speed=args.speed;}if(this.time>=this.last)this.time=this.first;this.running=true;break;
 case 'pause':case 'stop':this.running=false;break;
 case 'seek':if(!Number.isFinite(args.seconds)||args.seconds<this.first||args.seconds>this.last)throw Error('Replay seek outside recording');this.time=args.seconds;this.running=false;break;
 case 'state':break;
 default:throw Error('Unknown replay action');}return this.state();}
 state(){return {running:this.running,time:this.time,start:this.first,end:this.last,speed:this.speed,kind:'recorded-physics',physicsScope:'recorded results; playback speed does not change physics'};}
}
