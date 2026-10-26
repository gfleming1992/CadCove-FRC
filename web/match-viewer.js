import {BodyTransforms,writeMatrix,motionShader,qualityProfiles,renderDimensions,AdaptiveResolution} from './match-motion.js';
import {gpuMatrix} from './simulation-scene.js';
import {AssemblyViewer} from '../vendor/cad-core/src/core/assembly-viewer.js';
// WebGPU clip space is -w..w in x/y and 0..w in z (including reversed depth).
export function frustumPlanes(matrix){
 const row=r=>[matrix[r],matrix[4+r],matrix[8+r],matrix[12+r]],w=row(3),z=row(2),combine=(a,b,s)=>a.map((v,i)=>v+s*b[i]);
 return [combine(w,row(0),1),combine(w,row(0),-1),combine(w,row(1),1),combine(w,row(1),-1),z,combine(w,z,-1)].map(p=>{const n=Math.hypot(...p.slice(0,3));return n?p.map(v=>v/n):p;});
}
export const visibleSphere=(planes,center,radius)=>planes.every(p=>p[0]*center[0]+p[1]*center[1]+p[2]*center[2]+p[3]>=-radius);
export function selectVisualLevel(levels,pixelsPerMetre,budgetPixels=1.5){
 let best=levels[0];for(const level of levels)if(level.errorMetres*pixelsPerMetre<=budgetPixels&&level.triangles<best.triangles)best=level;return best;
}
// App-owned presentation adapter; the pinned generic CAD viewer stays unchanged.
export class MatchViewer extends AssemblyViewer{
 async init(){
  this.quality='auto';this.adaptive=new AdaptiveResolution();this.renderStats={frames:0,bodyUpdates:0,bodyUploadBytes:0,cpuMs:0,completedMs:0};
  await super.init();
  this.motionPipeline=await this.device.createComputePipelineAsync({layout:'auto',compute:{module:this.device.createShaderModule({code:motionShader}),entryPoint:'main'}});
  return this;
 }
 setQuality(value){
  if(!qualityProfiles[value])throw Error('Unknown graphics quality');this.quality=value;this.adaptive=new AdaptiveResolution();this.resize();this.request();
 }
 resize(){
  if(!this.device)return;
  const [w,h]=renderDimensions(this.canvas.clientWidth,this.canvas.clientHeight,devicePixelRatio,this.quality??'auto',this.adaptive?.scale??1);
  if(this.canvas.width===w&&this.canvas.height===h&&this.depth)return;
  this.canvas.width=w;this.canvas.height=h;this.depth?.destroy();this.multisample?.destroy();
  this.depth=this.device.createTexture({size:[w,h],sampleCount:4,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  this.multisample=this.device.createTexture({size:[w,h],sampleCount:4,format:navigator.gpu.getPreferredCanvasFormat(),usage:GPUTextureUsage.RENDER_ATTACHMENT});this.request();
 }
 request(){
  this.requested=true;if(this.pending||this.inFlight||!this.device||document.hidden)return;
  this.pending=true;requestAnimationFrame(()=>{this.pending=false;if(document.hidden)return;this.requested=false;try{this.render();}catch(error){if(this.onRenderError)this.onRenderError(error);else console.error(error);}});
 }
 render(){
  if(!this.depth)return;if(this.inFlight){this.requested=true;return;}
  const start=performance.now(),encoder=this.device.createCommandEncoder();
  if(this.pendingBodies||this.motionDirty){
   const changed=this.pendingBodies?this.bodyTransforms.update(this.pendingBodies):0;this.pendingBodies=null;
   if(changed||this.motionDirty){
    this.motionDirty=false;
    const matrices=this.bodyTransforms.matrices;this.device.queue.writeBuffer(this.bodyBuffer,0,matrices);
    const pass=encoder.beginComputePass();pass.setPipeline(this.motionPipeline);pass.setBindGroup(0,this.motionGroup);pass.dispatchWorkgroups(Math.ceil(this.instanceCount/64));pass.end();
    this.renderStats.bodyUpdates+=changed;this.renderStats.bodyUploadBytes+=matrices.byteLength;
   }
  }
  const matrix=this.matrix();this.device.queue.writeBuffer(this.uniform,0,matrix);
  const pass=encoder.beginRenderPass({colorAttachments:[{view:this.multisample.createView(),resolveTarget:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'discard',clearValue:{r:.047,g:.065,b:.084,a:1}}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'discard'}});
  this.draw(pass,matrix);pass.end();this.device.queue.submit([encoder.finish()]);this.frames++;this.renderStats.cpuMs=performance.now()-start;this.inFlight=true;
  this.device.queue.onSubmittedWorkDone().then(()=>{
   this.inFlight=false;this.renderStats.frames++;this.renderStats.completedMs=performance.now()-start;
   if(this.quality==='auto'&&this.adaptive.observe(this.renderStats.completedMs))this.resize();
   if(this.requested)this.request();
  }).catch(()=>{this.inFlight=false;});
 }
 setBodyPoses(bodies){this.pendingBodies=bodies;this.hierarchical=true;this.request();}

 setAssembly(definition,fit=true){
  const expanded=[],variants=new Map();
  for(const n of definition.instances){
   const entries=[{...n,errorMetres:0},...(n.lods||[]).map((l,i)=>({...n,id:n.id+'\u001fLOD'+i,asset:l.asset,errorMetres:l.errorMetres}))];
   variants.set(n.id,entries);expanded.push(...entries);
  }
  super.setAssembly({...definition,instances:expanded},fit);
  this.hierarchical=false;this.pendingBodies=null;this.motionDirty=false;this.bodyTransforms=new BodyTransforms(definition.instances.map(n=>n.body).filter(Boolean));
  const locals=new Float32Array(this.instanceCount*16),slots=new Uint32Array(this.instanceCount),byId=new Map(expanded.map(n=>[n.id,n]));
  for(const [id,index]of this.instanceLookup){const n=byId.get(id);writeMatrix(locals,index*16,n.body?gpuMatrix(n.local):n.transform);slots[index]=n.body?this.bodyTransforms.slots.get(n.body):0;}
  this.localMatrices=locals;this.bodySlots=slots;this.worldCenters=new Float32Array(this.instanceCount*3);
  const create=(data)=>{const b=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(b,0,data);return b;};
  this.bodyBuffer?.destroy();this.localBuffer?.destroy();this.slotBuffer?.destroy();
  this.bodyBuffer=create(this.bodyTransforms.matrices);this.localBuffer=create(locals);this.slotBuffer=create(slots);
  this.motionGroup=this.device.createBindGroup({layout:this.motionPipeline.getBindGroupLayout(0),entries:[this.bodyBuffer,this.localBuffer,this.slotBuffer,this.assemblyInstances].map((buffer,binding)=>({binding,resource:{buffer}}))});
  this.matchBundle=null;this.logicalInstanceCount=definition.instances.length;this.visualVariants=variants;
  this.visualGroups=[...variants.values()].map(entries=>{
   const first=this.instanceLookup.get(entries[0].id),bounds=this.instanceLocalBounds[first];
   const center=bounds.low.map((v,k)=>(v+bounds.high[k])/2),m=locals.subarray(first*16,first*16+16),localCenter=[0,1,2].map(r=>m[12+r]+m[r]*center[0]+m[4+r]*center[1]+m[8+r]*center[2]);
   return {first,body:slots[first],localCenter,localScale:Math.hypot(m[0],m[1],m[2]),center,radius:Math.hypot(...bounds.high.map((v,k)=>(v-bounds.low[k])/2)),levels:entries.map(n=>{const index=this.instanceLookup.get(n.id);return {index,errorMetres:n.errorMetres,triangles:this.instanceDraws[index].count/3};})};
  });
 }
 setOpacity(changes){super.setOpacity(changes);if(this.hierarchical){this.motionDirty=true;this.request();}}
 setTransforms(changes){
  if(this.hierarchical)throw Error('Update authoritative body poses instead of individual part transforms');
  if(!this.visualVariants)return super.setTransforms(changes);const expanded={};
  for(const [id,matrix]of Object.entries(changes)){const variants=this.visualVariants.get(id);if(!variants)throw Error('Unknown visual instance '+id);for(const n of variants)expanded[n.id]=matrix;}
  super.setTransforms(expanded);
 }
 drawSelected(pass,selected){
  const opaque=[],transparent=[];for(const i of selected){const a=this.placements[i*20+19];if(a>=1)opaque.push(i);else if(a>0)transparent.push(i);}opaque.sort((a,b)=>a-b);
  const bind=(target,pipeline)=>{target.setPipeline(pipeline);target.setBindGroup(0,this.assemblyGroup);target.setVertexBuffer(0,this.assemblyVertices);target.setIndexBuffer(this.assemblyIndices,'uint32');};
  const previous=this.matchBundle;
  if(!previous||previous.indices.length!==opaque.length||opaque.some((v,i)=>v!==previous.indices[i])){
   const encoder=this.device.createRenderBundleEncoder({colorFormats:[navigator.gpu.getPreferredCanvasFormat()],depthStencilFormat:'depth32float',sampleCount:4});bind(encoder,this.assemblyPipeline);let draws=0;
   for(let k=0;k<opaque.length;k++){const first=opaque[k],d=this.instanceDraws[first];let count=1;while(opaque[k+1]===first+count&&opaque[k+1]<d.firstInstance+d.instances){count++;k++;}encoder.drawIndexed(d.count,count,d.index,d.vertex,first);draws++;}
   this.matchBundle={indices:opaque,bundle:encoder.finish(),draws};
  }
  pass.executeBundles([this.matchBundle.bundle]);this.visualStats.drawCalls=this.matchBundle.draws+transparent.length;
  if(!transparent.length)return;
  const c=this.camera,direction=[Math.sin(c.pitch)*Math.cos(c.yaw),Math.sin(c.pitch)*Math.sin(c.yaw),Math.cos(c.pitch)],centers=this.worldCenters;
  const depth=i=>centers[i*3]*direction[0]+centers[i*3+1]*direction[1]+centers[i*3+2]*direction[2];transparent.sort((a,b)=>depth(a)-depth(b)||a-b);bind(pass,this.transparentPipeline);
  for(const i of transparent){const d=this.instanceDraws[i];pass.drawIndexed(d.count,1,d.index,d.vertex,i);}
 }
 draw(pass,matrix=this.matrix()){
  if(!this.visualGroups)return super.draw(pass);const planes=frustumPlanes(matrix),selected=[];let triangles=0,culled=0;
  const focalPixels=this.canvas.height/(2*Math.tan(Math.PI/8)),quality=qualityProfiles[this.quality??'auto'];
  for(const g of this.visualGroups){
   let cx,cy,cz,scale;
   if(this.hierarchical){
    if(g.version!==this.bodyTransforms.versions[g.body]){
     const m=this.bodyTransforms.matrices,o=g.body*16,[x,y,z]=g.localCenter;
     g.cx=m[o+12]+m[o]*x+m[o+4]*y+m[o+8]*z;g.cy=m[o+13]+m[o+1]*x+m[o+5]*y+m[o+9]*z;g.cz=m[o+14]+m[o+2]*x+m[o+6]*y+m[o+10]*z;g.version=this.bodyTransforms.versions[g.body];
    }
    cx=g.cx;cy=g.cy;cz=g.cz;scale=g.localScale;
   }else{
    const offset=g.first*20,p=this.placements,[x,y,z]=g.center;
    cx=p[offset+12]+x*p[offset]+y*p[offset+4]+z*p[offset+8];cy=p[offset+13]+x*p[offset+1]+y*p[offset+5]+z*p[offset+9];cz=p[offset+14]+x*p[offset+2]+y*p[offset+6]+z*p[offset+10];
    scale=Math.hypot(p[offset],p[offset+1],p[offset+2]);
   }
   const radius=g.radius*scale;
   let visible=true;for(const plane of planes)if(plane[0]*cx+plane[1]*cy+plane[2]*cz+plane[3]<-radius){visible=false;break;}
   if(!visible){culled++;continue;}
   const depth=matrix[3]*cx+matrix[7]*cy+matrix[11]*cz+matrix[15],pixelsPerMetre=focalPixels/Math.max(.0001,depth-radius);
   // Tiny hardware may be omitted only below a pixel in projected diameter.
   if(depth>radius&&2*radius*pixelsPerMetre<(quality.tiny)){culled++;continue;}
   const level=selectVisualLevel(g.levels,pixelsPerMetre*scale*1000,quality.error);selected.push(level.index);const ci=level.index*3;this.worldCenters[ci]=cx;this.worldCenters[ci+1]=cy;this.worldCenters[ci+2]=cz;triangles+=level.triangles;
  }
  this.visualStats={logicalInstances:this.logicalInstanceCount,drawnInstances:selected.length,culledInstances:culled,triangles};
  this.drawSelected(pass,selected);
 }
}
