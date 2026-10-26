// Runs inside a test page against real WebGPU buffers, not CPU shadow copies.
export async function verifyMatchRendering(){
 const m=window.cadcoveMatch,v=m.viewer,check=(ok,message)=>{if(!ok)throw Error(message);};
 await v.device.queue.onSubmittedWorkDone();
 // Production placements need no readback usage. Copy through a test compute
 // pass into a staging buffer so the renderer's actual output is verified.
 const bytes=v.placements.byteLength,device=v.device;
 const result=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:'@group(0) @binding(0) var<storage,read> a:array<f32>; @group(0) @binding(1) var<storage,read_write> b:array<f32>; @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x<arrayLength(&a)){b[id.x]=a[id.x];}}'}),entryPoint:'main'}});
 const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:v.assemblyInstances}},{binding:1,resource:{buffer:result}}]});
 const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(bytes/4/64));pass.end();encoder.copyBufferToBuffer(result,0,staging,0,bytes);const expectedBodies=v.bodyTransforms.matrices.slice();device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);const actual=new Float32Array(staging.getMappedRange().slice(0));staging.unmap();result.destroy();staging.destroy();
 let checked=0;
 for(const n of v.assemblyDefinition.instances){
  const index=v.instanceLookup.get(n.id),o=index*20,local=v.localMatrices.subarray(index*16,index*16+16),slot=v.bodySlots[index],a=expectedBodies.subarray(slot*16,slot*16+16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let expected=0;for(let k=0;k<4;k++)expected+=a[k*4+r]*local[c*4+k];check(Math.abs(actual[o+c*4+r]-expected)<.00001,'GPU placement differs: '+n.id);}
  for(let k=16;k<20;k++)check(actual[o+k]===v.placements[o+k],'GPU motion changed material');checked++;
 }
 check(v.renderStats.bodyUploadBytes>0,'Body transforms were not uploaded');
 return {checked,bodySlots:v.bodyTransforms.ids.length,renderStats:v.renderStats,visualStats:v.visualStats};
}
