// One offscreen frame. Reuses the live device, pipeline and geometry buffers;
// separate uniforms/placements keep the visible camera and animation untouched.
export async function captureAssembly(viewer,{ids,transforms={},camera,view='iso',width=960,height=720}={}){
 if(!viewer.draws||!viewer.instanceLookup)throw Error('Load an assembly before capture');
 if(viewer.capturePending)throw Error('Assembly capture already in progress');
 if(![width,height].every(v=>Number.isInteger(v)&&v>=1&&v<=2048))throw Error('Capture dimensions must be 1–2048 pixels');
 const poses={front:[-Math.PI/2,Math.PI/2],right:[0,Math.PI/2],top:[-Math.PI/2,.001],iso:[1,1]};
 if(!poses[view])throw Error('View must be front, right, top or iso');
 const selected=ids??[...viewer.instanceLookup.keys()];
 if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length)throw Error('Expected unique nonempty capture IDs');
 const indices=selected.map(id=>{const i=viewer.instanceLookup.get(id);if(i===undefined)throw Error('Unknown capture instance '+id);return i;}).sort((a,b)=>a-b);
 const placements=viewer.placements.slice();
 for(const [id,color] of viewer.selectionOriginalColors??[]){const i=viewer.instanceLookup.get(id);if(i!==undefined)placements.set(color,i*20+16);}
 for(const [id,m]of Object.entries(transforms)){
  const i=viewer.instanceLookup.get(id);if(i===undefined)throw Error('Unknown transform instance '+id);
  for(let r=0;r<4;r++)for(let c=0;c<4;c++)placements[i*20+c*4+r]=r===3?(c===3?1:0):m[r*4+c];
 }
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
 for(const i of indices){const b=viewer.instanceLocalBounds[i];for(let corner=0;corner<8;corner++){
  const p=[0,1,2].map(k=>(corner>>k)&1?b.high[k]:b.low[k]);
  for(let r=0;r<3;r++){const v=placements[i*20+12+r]+p.reduce((s,x,k)=>s+x*placements[i*20+k*4+r],0);low[r]=Math.min(low[r],v);high[r]=Math.max(high[r],v);}
 }}
 const center=low.map((v,i)=>(v+high[i])/2),radius=Math.max(.001,Math.hypot(...high.map((v,i)=>v-low[i]))/2);
 const halfFov=Math.atan(Math.tan(Math.PI/8)*Math.min(1,width/height));
 const c=camera?{...camera,target:Array.isArray(camera.target)?[...camera.target]:camera.target}:{target:center,distance:radius/Math.sin(halfFov)*1.1,yaw:poses[view][0],pitch:poses[view][1]};
 if(!Array.isArray(c.target)||c.target.length!==3||![...c.target,c.distance,c.yaw,c.pitch].every(Number.isFinite)||c.distance<=0||c.pitch<=0||c.pitch>=Math.PI)throw Error('Invalid capture camera');
 const device=viewer.device,format=navigator.gpu.getPreferredCanvasFormat();
 if(!['bgra8unorm','rgba8unorm'].includes(format))throw Error('Unsupported capture pixel format '+format);
 const resources=[],texture=(desc)=>{const t=device.createTexture(desc);resources.push(t);return t;};
 const buffer=(desc)=>{const b=device.createBuffer(desc);resources.push(b);return b;};
 viewer.capturePending=true;
 try{
  const color=texture({size:[width,height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const msaa=texture({size:[width,height],sampleCount:4,format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
  const depth=texture({size:[width,height],sampleCount:4,format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  const uniform=buffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const instanceBuffer=buffer({size:placements.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(uniform,0,viewer.matrix({camera:c,width,height,center,radius}));
  device.queue.writeBuffer(instanceBuffer,0,placements);
  const group=device.createBindGroup({layout:viewer.assemblyPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:instanceBuffer}}]});
  const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({
   colorAttachments:[{view:msaa.createView(),resolveTarget:color.createView(),loadOp:'clear',storeOp:'discard',clearValue:{r:.047,g:.065,b:.084,a:1}}],
   depthStencilAttachment:{view:depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'discard'}});
  viewer.drawAssembly(pass,{indices,placements,camera:c,group});
  pass.end();
  const bytesPerRow=Math.ceil(width*4/256)*256;
  const readback=buffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  encoder.copyTextureToBuffer({texture:color},{buffer:readback,bytesPerRow,rowsPerImage:height},[width,height]);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const mapped=new Uint8Array(readback.getMappedRange()),rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)rgba.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);
  readback.unmap();
  if(format==='bgra8unorm')for(let i=0;i<rgba.length;i+=4){const r=rgba[i];rgba[i]=rgba[i+2];rgba[i+2]=r;}
  const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);
  const blob=await canvas.convertToBlob({type:'image/png'});
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  return {image,width,height,camera:c,bounds:{low,high},instanceIds:[...selected]};
 }finally{for(const resource of resources)resource.destroy();viewer.capturePending=false;}
}
