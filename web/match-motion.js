// Presentation-only rigid hierarchy. CAD vertices are millimetres; local
// translations and authoritative body positions are metres. Slot zero is world.
export function writeMatrix(out,offset,m=[1,0,0,0,0,1,0,0,0,0,1,0]){
 for(let c=0;c<4;c++)for(let r=0;r<4;r++)out[offset+c*4+r]=r===3?(c===3?1:0):m[r*4+c];
}
export function writePose(out,offset,pose){
 const p=pose?.position,q=pose?.quaternion;
 if(p?.length!==3||q?.length!==4||!p.every(Number.isFinite)||!q.every(Number.isFinite)||Math.abs(Math.hypot(...q)-1)>.001)throw Error('Invalid rigid body pose');
 const [x,y,z,w]=q;
 out.set([1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,p[0],p[1],p[2],1],offset);
}
export class BodyTransforms{
 constructor(ids){
  this.ids=[...new Set(ids)];this.slots=new Map(this.ids.map((id,i)=>[id,i+1]));this.matrices=new Float32Array((this.ids.length+1)*16);
  this.matrices.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);this.previous=null;this.versions=new Uint32Array(this.ids.length+1);
 }
 update(bodies){
  let changed=0;
  for(let i=0;i<this.ids.length;i++){const id=this.ids[i],pose=bodies[id];if(!pose)throw Error('Missing body pose '+id);if(this.previous?.[id]===pose)continue;writePose(this.matrices,(i+1)*16,pose);this.versions[i+1]++;changed++;}
  this.previous=bodies;return changed;
 }
}
export const motionShader=`
struct Instance {matrix:mat4x4f,color:vec4f};
@group(0) @binding(0) var<storage,read> bodies:array<mat4x4f>;
@group(0) @binding(1) var<storage,read> locals:array<mat4x4f>;
@group(0) @binding(2) var<storage,read> slots:array<u32>;
@group(0) @binding(3) var<storage,read_write> instances:array<Instance>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&slots)){return;}
 instances[id.x].matrix=bodies[slots[id.x]]*locals[id.x];
}`;
export const qualityProfiles={
 auto:{pixels:1920*1080,ratio:1.5,error:1.5,tiny:.5},
 performance:{pixels:1280*720,ratio:1,error:2,tiny:1},
 high:{pixels:2560*1440,ratio:2,error:1,tiny:.5}
};
export function renderDimensions(width,height,dpr,quality='auto',scale=1){
 const p=qualityProfiles[quality];if(!p)throw Error('Unknown graphics quality');
 const ratio=Math.min(dpr||1,p.ratio,Math.sqrt(p.pixels/Math.max(1,width*height)))*scale;
 return [Math.max(1,Math.floor(width*ratio)),Math.max(1,Math.floor(height*ratio))];
}
// Sustained completed-frame costs, not single spikes. Never increases beyond
// the chosen pixel cap; resolution changes do not affect authoritative poses.
export class AdaptiveResolution{
 constructor(){this.scale=1;this.slow=0;this.fast=0;}
 observe(ms){
  this.slow=ms>20?this.slow+1:0;this.fast=ms<12?this.fast+1:0;
  const before=this.scale;
  if(this.slow>=30){this.scale=Math.max(.6,this.scale*.85);this.slow=0;this.fast=0;}
  if(this.fast>=180){this.scale=Math.min(1,this.scale/.85);this.fast=0;this.slow=0;}
  return this.scale!==before;
 }
}
