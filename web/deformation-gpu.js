import {checkedTopology,checkedCoordinates} from './deformation-data.js';
export {createDeformationPrototype} from './deformation-data.js';

const shader=`
struct Params { alpha:f32, scale:f32, vertexCount:u32, pad:u32, offset:vec4f };
@group(0) @binding(0) var<storage,read> frameA:array<f32>;
@group(0) @binding(1) var<storage,read> frameB:array<f32>;
@group(0) @binding(2) var<storage,read> triangles:array<u32>;
@group(0) @binding(3) var<storage,read> offsets:array<u32>;
@group(0) @binding(4) var<storage,read> faces:array<u32>;
@group(0) @binding(5) var<storage,read_write> vertices:array<f32>;
@group(0) @binding(6) var<uniform> params:Params;
fn point(i:u32)->vec3f {
 let at=i*3u;
 return mix(vec3f(frameA[at],frameA[at+1u],frameA[at+2u]),vec3f(frameB[at],frameB[at+1u],frameB[at+2u]),params.alpha)*params.scale+params.offset.xyz;
}
@compute @workgroup_size(64) fn deform(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x;
 if(i>=params.vertexCount){return;}
 let p=point(i);var normal=vec3f(0);
 for(var f=offsets[i];f<offsets[i+1u];f++){
  let t=faces[f]*3u;
  let a=point(triangles[t]);let b=point(triangles[t+1u]);let c=point(triangles[t+2u]);
  normal+=cross(b-a,c-a);
 }
 let lengthSquared=dot(normal,normal);
 if(lengthSquared>1e-20){normal=normal*inverseSqrt(lengthSquared);}else{normal=vec3f(0,0,1);}
 let out=i*6u;
 vertices[out]=p.x;vertices[out+1u]=p.y;vertices[out+2u]=p.z;
 vertices[out+3u]=normal.x;vertices[out+4u]=normal.y;vertices[out+5u]=normal.z;
}`;

/** GPU presentation of immutable physics particle frames, without a client solve.
 * Prototype coordinates and placements must agree: world-space SI particles use
 * scale=1000 and an identity instance placement in the millimetre CAD viewer.
 * A prototype must be unique to the ball and already have the supplied topology.
 * New assembly buffers invalidate this adapter. Dispose/recreate after rebuilding.
 * Frames are immutable: reuse their arrays to avoid repeated validation/uploads;
 * supply a new array after edits. No per-display-frame CPU vertex or normal work.
 * CaptureView draws the same GPU buffers. CPU mesh picking/export remains the
 * initial mesh; this adapter does not overwrite immutable CAD or mesh caches.
 */
export class GpuDeformation {
 static async create(viewer,partId,topology,options={}) {
  const slot=viewer.meshSlots?.get(partId),t=checkedTopology(topology);
  if(!viewer.device||!slot||slot.count!==t.surfaceVertexCount)throw Error('Deformation prototype does not match surface vertex count');
  if(viewer.instanceAssets.filter(id=>id===partId).length!==1)throw Error('Deformation prototype must belong to exactly one instance');
  if(slot.part.indices.length!==t.indices.length||t.indices.some((n,i)=>slot.part.indices[i]!==n))throw Error('Deformation prototype triangle topology differs');
  const scale=options.scale??1000,offsetMm=options.offsetMm??[0,0,0];
  checkedCoordinates(new Float32Array(t.particleCount*3),t.particleCount,{scale,offsetMm});
  if(!(viewer.assemblyVertices.usage&GPUBufferUsage.COPY_DST))throw Error('Assembly vertex buffer cannot receive GPU deformation');
  const d=new GpuDeformation();Object.assign(d,{viewer,partId,slot,topology:t,scale,offsetMm:[...offsetMm],target:viewer.assemblyVertices,resources:[],cache:new WeakMap(),disposed:false,uploads:0,updates:0,bytesUploaded:0});
  const device=viewer.device;
  const buffer=(size,usage,data)=>{const b=device.createBuffer({label:'deformation/'+partId,size,usage});d.resources.push(b);if(data)device.queue.writeBuffer(b,0,data);return b;};
  try{
   const module=device.createShaderModule({label:'Particle surface interpolation and normals',code:shader});
   d.pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'deform'}});
   d.frameA=buffer(t.particleCount*12,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
   d.frameB=buffer(t.particleCount*12,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
   d.output=buffer(t.surfaceVertexCount*24,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
   d.params=buffer(32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
   const indices=buffer(t.indices.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,t.indices),offsets=buffer(t.offsets.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,t.offsets),faces=buffer(t.faces.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,t.faces);
   d.group=device.createBindGroup({layout:d.pipeline.getBindGroupLayout(0),entries:[d.frameA,d.frameB,indices,offsets,faces,d.output,d.params].map((buffer,binding)=>({binding,resource:{buffer}}))});
   d.paramBytes=new ArrayBuffer(32);d.paramFloats=new Float32Array(d.paramBytes);d.paramIntegers=new Uint32Array(d.paramBytes);
   d.paramFloats[1]=scale;d.paramIntegers[2]=t.surfaceVertexCount;d.paramFloats.set(offsetMm,4);
   d.boundsIndices=viewer.instanceAssets.flatMap((id,i)=>id===partId?[i]:[]);
   return d;
  }catch(e){d.dispose();throw e;}
 }
 assertCurrent(){
  if(this.disposed)throw Error('Deformation adapter is disposed');
  if(this.viewer.assemblyVertices!==this.target||this.viewer.meshSlots?.get(this.partId)!==this.slot)throw Error('Deformation adapter is stale after assembly replacement');
 }
 prepared(particles){
  let value=this.cache.get(particles);
  if(value){if(value.sourceLength!==particles.length)throw Error('Cached particle frame changed length');return value;}
  value=checkedCoordinates(particles,this.topology.particleCount,{scale:this.scale,offsetMm:this.offsetMm});
  this.cache.set(particles,value);return value;
 }
 update({particlesA,particlesB=particlesA,alpha=0}) {
  this.assertCurrent();
  if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw Error('Interpolation alpha must be between zero and one');
  const a=this.prepared(particlesA),b=this.prepared(particlesB),device=this.viewer.device;
  // Validate both frames before writing anything: a rejected update is atomic.
  if(this.lastA!==a){device.queue.writeBuffer(this.frameA,0,a.data);this.uploads++;this.bytesUploaded+=a.data.byteLength;}
  if(this.lastB!==b){device.queue.writeBuffer(this.frameB,0,b.data);this.uploads++;this.bytesUploaded+=b.data.byteLength;}
  if(this.lastA!==a||this.lastB!==b){
   const bounds={low:a.bounds.low.map((n,k)=>Math.min(n,b.bounds.low[k])),high:a.bounds.high.map((n,k)=>Math.max(n,b.bounds.high[k]))};
   for(const i of this.boundsIndices)this.viewer.instanceLocalBounds[i]=bounds;
  }
  this.lastA=a;this.lastB=b;this.paramFloats[0]=alpha;
  device.queue.writeBuffer(this.params,0,this.paramBytes);
  const encoder=device.createCommandEncoder({label:'Deform surface only'}),pass=encoder.beginComputePass();
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.dispatchWorkgroups(Math.ceil(this.topology.surfaceVertexCount/64));pass.end();
  encoder.copyBufferToBuffer(this.output,0,this.target,this.slot.vertex*24,this.topology.surfaceVertexCount*24);
  device.queue.submit([encoder.finish()]);this.updates++;this.viewer.request();
 }
 get stats(){return {backend:'webgpu-compute',surfaceVertices:this.topology.surfaceVertexCount,triangles:this.topology.indices.length/3,updates:this.updates,particleUploads:this.uploads,particleUploadBytes:this.bytesUploaded,gpuBytes:this.resources.reduce((n,b)=>n+b.size,0),disposed:this.disposed};}
 // Explicit test/diagnostic readback, never used by normal playback or capture.
 async readback(){
  this.assertCurrent();const device=this.viewer.device,b=device.createBuffer({size:this.topology.surfaceVertexCount*24,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(this.output,0,b,0,b.size);device.queue.submit([encoder.finish()]);await b.mapAsync(GPUMapMode.READ);const result=new Float32Array(b.getMappedRange().slice(0));b.unmap();return result;}finally{b.destroy();}
 }
 dispose(){if(this.disposed)return;for(const resource of this.resources)resource.destroy();this.resources=[];this.cache=new WeakMap();this.disposed=true;}
}
