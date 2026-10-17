import {Viewer} from './viewer.js';
// Same shader and camera math as the interactive scene. An isolated set of
// buffers prevents captures/selection fitting from changing the user's camera.
export async function captureScene(viewer,{ids,view='iso',width=960,height=720}={}) {
 if(!viewer.scene)throw Error('Build a scene before capturing');
 if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=2048))throw Error('Capture size must be 1–2048');
 const poses={iso:[1,1],front:[-Math.PI/2,Math.PI/2],back:[Math.PI/2,Math.PI/2],right:[0,Math.PI/2],left:[Math.PI,Math.PI/2],top:[-Math.PI/2,.001],bottom:[-Math.PI/2,Math.PI-.001]};
 if(!poses[view])throw Error('Unknown capture view');
 const parts=ids?viewer.scene.parts.filter(p=>ids.includes(p.id)):viewer.scene.parts;
 if(!parts.length||(ids&&new Set(ids).size!==parts.length))throw Error('Unknown, duplicate or empty capture part IDs');
 const device=viewer.device,resources=[],format=navigator.gpu.getPreferredCanvasFormat();
 const capture=Object.create(Viewer.prototype);
 Object.assign(capture,{device,pipeline:viewer.pipeline,canvas:{width,height,clientWidth:width,clientHeight:height},camera:{target:[0,0,0],distance:1,yaw:poses[view][0],pitch:poses[view][1]},request(){}});
 const texture=desc=>{const t=device.createTexture(desc);resources.push(t);return t;};
 const buffer=desc=>{const b=device.createBuffer(desc);resources.push(b);return b;};
 try{
  capture.setScene({parts},true);
  const color=texture({size:[width,height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const msaa=texture({size:[width,height],sampleCount:4,format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
  const depth=texture({size:[width,height],sampleCount:4,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  const uniform=buffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(uniform,0,capture.matrix());
  const group=device.createBindGroup({layout:viewer.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]});
  const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:msaa.createView(),resolveTarget:color.createView(),loadOp:'clear',storeOp:'discard',clearValue:{r:.047,g:.065,b:.084,a:1}}],depthStencilAttachment:{view:depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'discard'}});
  pass.setPipeline(viewer.pipeline);pass.setBindGroup(0,group);
  for(const b of capture.batches)if(b){pass.setVertexBuffer(0,b.vertices);pass.setIndexBuffer(b.indices,'uint32');pass.drawIndexed(b.count);}
  pass.end();
  const bytesPerRow=Math.ceil(width*4/256)*256,readback=buffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  encoder.copyTextureToBuffer({texture:color},{buffer:readback,bytesPerRow,rowsPerImage:height},[width,height]);device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const mapped=new Uint8Array(readback.getMappedRange()),rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)rgba.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);readback.unmap();
  if(format==='bgra8unorm')for(let i=0;i<rgba.length;i+=4){const r=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=r;}
  const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
  const blob=await canvas.convertToBlob({type:'image/png'});
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  return {image,width,height,view,ids:parts.map(p=>p.id),camera:capture.camera};
 }finally{for(const b of capture.batches??[])if(b){b.vertices.destroy();b.indices.destroy();}for(const r of resources)r.destroy();}
}
