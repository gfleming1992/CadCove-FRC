import {randomUUID} from 'node:crypto';
// Sphere surface ordering matches Rapier's pinned soft_body_builder_mesh_helpers.
// This is topology only, not a second deformation/physics calculation.
export function compliantSphereTopology(subdivisions=1){
 if(!Number.isInteger(subdivisions)||subdivisions<0||subdivisions>2)throw Error('Particle stream supports sphere subdivisions 0–2');
 const t=(1+Math.sqrt(5))/2,normal=p=>{const n=Math.hypot(...p);return p.map(v=>v/n);};
 let points=[[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(normal);
 let faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
 for(let level=0;level<subdivisions;level++){const cache=new Map(),mid=(a,b)=>{const key=[Math.min(a,b),Math.max(a,b)].join(':');if(cache.has(key))return cache.get(key);const id=points.length;points.push(normal(points[a].map((n,k)=>(n+points[b][k])/2)));cache.set(key,id);return id;},next=[];for(const [a,b,c]of faces){const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);next.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]);}faces=next;}
 return {surfaceVertexCount:points.length,centerParticleIndex:points.length,particleCount:points.length+1,indices:faces.flat()};
}
export class NativeParticleStream{
 constructor(){this.reset();}
 reset(){this.generation=(this.generation??0)+1;this.config=null;this.lastSample=-Infinity;this.announced=false;}
 configure(world,{bodyIds,maxHz=20,revision}={}){
  if(!Array.isArray(bodyIds)||!bodyIds.length||bodyIds.length>4||new Set(bodyIds).size!==bodyIds.length)throw Error('Select 1–4 unique deformable body IDs');
  if(!Number.isFinite(maxHz)||maxHz<1||maxHz>30)throw Error('Particle stream rate must be 1–30 Hz');
  if(typeof revision!=='string'||!revision.length||revision.length>256)throw Error('Particle stream requires a physics revision');
  const topologies={};for(const id of bodyIds){const body=world.bodies.find(b=>b.id===id),shape=body?.colliders?.[0];if(!body?.compliance||body.fixed||body.colliders?.length!==1||shape.kind!=='ball')throw Error('Body '+id+' has no native compliant sphere definition; rigid-only scenes cannot enable particles');topologies[id]=compliantSphereTopology(body.compliance.subdivisions??1);}
  this.reset();this.config={schema:1,streamId:randomUUID(),revision,maxHz,bodyIds:[...bodyIds],topologies};return this.config;
 }
 async sample(value,request,now=performance.now()){
  const config=this.config,generation=this.generation;if(!config||now-this.lastSample<1000/config.maxHz)return undefined;
  const state=value.state??value;if(!Number.isSafeInteger(state.tick)||!Number.isFinite(state.time))throw Error('Particle stream requires authoritative tick/time');
  this.lastSample=now;const bodies={};
  for(const id of config.bodyIds){
   if(!state.bodies?.[id])throw Error('Particle stream body disappeared');
   if(!state.compliance?.bodies?.[id]){bodies[id]={representation:'rigid'};continue;}
   const result=await request({op:'particles',body:id});
   if(generation!==this.generation)return undefined;
   const particles=result.points,count=config.topologies[id].particleCount;
   if(!Array.isArray(particles)||particles.length!==count||particles.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6)))throw Error('Invalid native particle positions for '+id);
   bodies[id]={representation:'soft',particles};
  }
  if(generation!==this.generation)return undefined;
  const packet={schema:1,streamId:config.streamId,revision:config.revision,tick:state.tick,time:state.time,bodies,...(!this.announced?{topologies:config.topologies}:{})};this.announced=true;return packet;
 }
}
