// Optional generic assembly renderer. CAD sources/caches stay immutable while
// applications animate placements. No physics or domain dependency lives here.
import {Viewer} from './viewer.js';
import {meshEdges} from './mesh-edges.js';
import {captureAssembly} from './assembly-capture.js';
export const ASSEMBLY_VIEW_API_VERSION = 1;
const identity=[1,0,0,0,0,1,0,0,0,0,1,0];
const shader=`
struct View {mvp:mat4x4f};
struct Instance {matrix:mat4x4f,color:vec4f};
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var<storage,read> instances:array<Instance>;
struct Out {@builtin(position) position:vec4f,@location(0) normal:vec3f,@location(1) color:vec4f};
fn vertex(p:vec3f,n:vec3f,index:u32)->Out {
 let i=instances[index];var o:Out;o.position=view.mvp*i.matrix*vec4f(p,1);
 o.normal=(i.matrix*vec4f(n,0)).xyz;o.color=i.color;return o;
}
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@builtin(instance_index) index:u32)->Out {return vertex(p,n,index);}
@fragment fn fs(o:Out,@builtin(front_facing) front:bool)->@location(0) vec4f {
 let n=normalize(o.normal)*select(-1.0,1.0,front);
 let key=max(dot(n,normalize(vec3f(-0.3,-0.6,1.0))),0.0);
 let fill=max(dot(n,normalize(vec3f(0.8,0.4,0.2))),0.0);
 let linear=pow(o.color.rgb,vec3f(2.2))*(0.42+0.55*key+0.18*fill);
 return vec4f(pow(linear,vec3f(1.0/2.2))*o.color.a,o.color.a);
}
@vertex fn edgeVS(@location(0) p:vec3f,@location(1) n:vec3f,@builtin(instance_index) index:u32)->Out {
 var o=vertex(p,n,index);o.position.z+=1e-6*o.position.w;return o;
}
@fragment fn edgeFS(o:Out)->@location(0) vec4f {return vec4f(o.color.rgb*0.32*o.color.a,o.color.a);}
`;
function checkedTransform(value=identity){
 if(value.length!==12||!value.every(Number.isFinite))throw Error('Expected finite row-major 3×4 transform');
 const cols=[0,1,2].map(c=>[value[c],value[c+4],value[c+8]]);
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),size=dot(cols[0],cols[0]);
 if(size<1e-16||cols.some(c=>Math.abs(dot(c,c)-size)>size*1e-4)||Math.abs(dot(cols[0],cols[1]))>size*1e-4||Math.abs(dot(cols[0],cols[2]))>size*1e-4||Math.abs(dot(cols[1],cols[2]))>size*1e-4)throw Error('Assembly placements require rigid transforms with uniform scale');
 return value;
}
function writeMatrix(buffer,offset,m){
 for(let r=0;r<4;r++)for(let c=0;c<4;c++)buffer[offset+c*4+r]=r===3?(c===3?1:0):m[r*4+c];
}
export class AssemblyViewer extends Viewer {
 async init(){
  await super.init();
  const module=this.device.createShaderModule({code:shader});
  const bindings=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
  const layout=this.device.createPipelineLayout({bindGroupLayouts:[bindings]}),format=navigator.gpu.getPreferredCanvasFormat();
  const descriptor={layout,vertex:{module,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'},multisample:{count:4}};
  this.assemblyPipeline=await this.device.createRenderPipelineAsync(descriptor);
  this.transparentPipeline=await this.device.createRenderPipelineAsync({...descriptor,fragment:{...descriptor.fragment,targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},depthStencil:{...descriptor.depthStencil,depthWriteEnabled:false}});
  this.edgePipeline=await this.device.createRenderPipelineAsync({...descriptor,vertex:{...descriptor.vertex,entryPoint:'edgeVS'},fragment:{module,entryPoint:'edgeFS',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'line-list'},depthStencil:{...descriptor.depthStencil,depthWriteEnabled:false,depthCompare:'greater-equal'}});
  return this;
 }
 setAssembly({prototypes,instances},fit=true){
  if(!instances.length)throw Error('Empty assembly');
  const previousOpacity=new Map([...(this.instanceLookup??[])].filter(([id,i])=>Math.abs(this.placements[i*20+19]-(this.materialOpacity?.get(id)??1))>1e-6).map(([id,i])=>[id,this.placements[i*20+19]]));
  const library=new Map(prototypes.map(p=>[p.id,p])),groups=new Map(),seen=new Set();
  if(library.size!==prototypes.length)throw Error('Duplicate prototype');
  for(const n of instances){
   if(seen.has(n.id)||!library.has(n.asset))throw Error('Duplicate instance or missing prototype: '+n.id);
   seen.add(n.id);checkedTransform(n.transform);
   if(!/^#[0-9a-f]{6}$/i.test(n.color))throw Error('Invalid instance color');
   if(n.opacity!==undefined&&(!Number.isFinite(n.opacity)||n.opacity<0||n.opacity>1))throw Error('Invalid material opacity');
   if(!groups.has(n.asset))groups.set(n.asset,[]);groups.get(n.asset).push(n);
  }
  const edges=new Map([...groups.keys()].map(id=>[id,meshEdges(library.get(id))]));
  const edgeData=new Uint32Array([...edges.values()].reduce((n,e)=>n+e.length,0));let edgeIndex=0;
  let vertices=0,indices=0;for(const asset of groups.keys()){const p=library.get(asset);vertices+=p.positions.length/3;indices+=p.indices.length;}
  const data=new Float32Array(vertices*6),indexData=new Uint32Array(indices),placements=new Float32Array(instances.length*20);
  const meshSlots=new Map(),instanceAssets=[];
  const draws=[],lookup=new Map(),localBounds=[],low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  let vertex=0,index=0,instance=0;
  for(const [asset,nodes] of groups){
   const p=library.get(asset),start=instance;meshSlots.set(asset,{vertex,count:p.positions.length/3,part:p});
   if(p.normals.length!==p.positions.length||!p.positions.every(Number.isFinite)||!p.normals.every(Number.isFinite)||p.indices.some(i=>i>=p.positions.length/3))throw Error('Invalid prototype mesh');
   const localMin=[Infinity,Infinity,Infinity],localMax=[-Infinity,-Infinity,-Infinity];
   for(let v=0;v<p.positions.length/3;v++)for(let k=0;k<3;k++){const x=p.positions[v*3+k];data[(vertex+v)*6+k]=x;data[(vertex+v)*6+3+k]=p.normals[v*3+k];localMin[k]=Math.min(localMin[k],x);localMax[k]=Math.max(localMax[k],x);}
   indexData.set(p.indices,index);
   for(const n of nodes){
    const m=n.transform??identity;writeMatrix(placements,instance*20,m);
    placements.set([1,3,5].map(i=>parseInt(n.color.slice(i,i+2),16)/255).concat(previousOpacity.get(n.id)??n.opacity??1),instance*20+16);
    instanceAssets.push(asset);localBounds.push({low:localMin,high:localMax});lookup.set(n.id,instance++);
    for(let corner=0;corner<8;corner++){const pt=[0,1,2].map(k=>(corner>>k)&1?localMax[k]:localMin[k]);for(let r=0;r<3;r++){const x=m[r*4+3]+pt.reduce((s,v,k)=>s+v*m[r*4+k],0);low[r]=Math.min(low[r],x);high[r]=Math.max(high[r],x);}}
   }
   const e=edges.get(asset);edgeData.set(e,edgeIndex);
   draws.push({count:p.indices.length,index,vertex,edgeIndex,edgeCount:e.length,firstInstance:start,instances:nodes.length});edgeIndex+=e.length;vertex+=p.positions.length/3;index+=p.indices.length;
  }
  if(!vertices||!indices)throw Error('Assembly has no geometry');
  const create=(array,usage)=>{const b=this.device.createBuffer({size:array.byteLength,usage:usage|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(b,0,array);return b;};
  const vb=create(data,GPUBufferUsage.VERTEX),ib=create(indexData,GPUBufferUsage.INDEX),sb=create(placements,GPUBufferUsage.STORAGE);
  this.assemblyEdges?.destroy();this.assemblyEdges=edgeData.length?create(edgeData,GPUBufferUsage.INDEX):null;
  this.assemblyVertices?.destroy();this.assemblyIndices?.destroy();this.assemblyInstances?.destroy();
  this.assemblyVertices=vb;this.assemblyIndices=ib;this.assemblyInstances=sb;this.placements=placements;this.instanceLookup=lookup;this.instanceLocalBounds=localBounds;this.draws=draws;this.meshSlots=meshSlots;this.instanceAssets=instanceAssets;this.deformedParts=new Map();
  this.assemblyGroup=this.device.createBindGroup({layout:this.assemblyPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:sb}}]});
  this.bounds={low,high};this.center=low.map((x,i)=>(x+high[i])/2);this.radius=Math.max(Math.hypot(...high.map((x,i)=>x-low[i]))/2,.001);
  this.gpuBytes=data.byteLength+indexData.byteLength+edgeData.byteLength+placements.byteLength;this.instanceCount=instances.length;
  this.opaqueBundle=null;this.assemblyDefinition={prototypes,instances};
  this.materialOpacity=new Map(instances.map(n=>[n.id,n.opacity??1]));
  this.instanceDraws=[];for(const d of draws)for(let i=d.firstInstance;i<d.firstInstance+d.instances;i++)this.instanceDraws[i]=d;
  if(fit)this.fit();this.request();
 }
 setTransforms(changes){
  const checked=Object.entries(changes).map(([id,m])=>{if(!this.instanceLookup?.has(id))throw Error('Unknown instance '+id);return [this.instanceLookup.get(id),checkedTransform(m)];});
  if(!checked.length)return;
  let first=Infinity,last=0;for(const [i,m] of checked){writeMatrix(this.placements,i*20,m);first=Math.min(first,i);last=Math.max(last,i);}
  this.device.queue.writeBuffer(this.assemblyInstances,first*80,this.placements.subarray(first*20,(last+1)*20));this.request();
 }
 setOpacity(changes){
  const checked=Object.entries(changes).map(([id,alpha])=>{const i=this.instanceLookup?.get(id);if(i===undefined||!Number.isFinite(alpha)||alpha<0||alpha>1)throw Error('Expected existing part IDs and opacity from 0 to 1');return [i,alpha];});
  if(!checked.length)return;
  let first=Infinity,last=0;for(const [i,alpha]of checked){this.placements[i*20+19]=alpha;first=Math.min(first,i);last=Math.max(last,i);}
  this.device.queue.writeBuffer(this.assemblyInstances,first*80,this.placements.subarray(first*20,(last+1)*20));this.request();
 }
 drawAssembly(pass,{indices,placements=this.placements,camera=this.camera,group=this.assemblyGroup}={}){
  const selected=indices??Array.from({length:this.instanceCount},(_,i)=>i),opaque=[],transparent=[];
  for(const i of selected){const alpha=placements[i*20+19];if(alpha>=1)opaque.push(i);else if(alpha>0)transparent.push(i);}
  opaque.sort((a,b)=>a-b);
  const drawOpaque=target=>{
   target.setPipeline(this.assemblyPipeline);target.setBindGroup(0,group);target.setVertexBuffer(0,this.assemblyVertices);target.setIndexBuffer(this.assemblyIndices,'uint32');
   for(let k=0;k<opaque.length;k++){const first=opaque[k],d=this.instanceDraws[first];let count=1;while(opaque[k+1]===first+count&&opaque[k+1]<d.firstInstance+d.instances){count++;k++;}target.drawIndexed(d.count,count,d.index,d.vertex,first);}
   this.drawEdges(target,opaque);
  };
  // Record opaque draw commands once. Moving joints/color updates write the
  // existing storage buffer, so the bundle stays reusable during playback.
  // Captures use their own transient bind group and deliberately bypass it.
  if(pass.executeBundles&&group===this.assemblyGroup&&this.useRenderBundles!==false){
   const key=(this.showEdges!==false)+':'+opaque.join(',');
   if(this.opaqueBundle?.key!==key){
    const encoder=this.device.createRenderBundleEncoder({colorFormats:[navigator.gpu.getPreferredCanvasFormat()],depthStencilFormat:'depth32float',sampleCount:4});
    drawOpaque(encoder);this.opaqueBundle={key,bundle:encoder.finish()};
   }
   pass.executeBundles([this.opaqueBundle.bundle]);
  }else drawOpaque(pass);
  if(!transparent.length)return;
  // Sort whole occurrences back-to-front. Intersecting translucent surfaces can
  // still show standard object-sorting artifacts; opacity is for visual review.
  const direction=[Math.sin(camera.pitch)*Math.cos(camera.yaw),Math.sin(camera.pitch)*Math.sin(camera.yaw),Math.cos(camera.pitch)];
  const depth=i=>{const b=this.instanceLocalBounds[i],p=b.low.map((x,k)=>(x+b.high[k])/2);return direction.reduce((sum,v,r)=>sum+v*(placements[i*20+12+r]+p.reduce((a,x,k)=>a+x*placements[i*20+k*4+r],0)),0);};
  const sorted=transparent.map(i=>({i,depth:depth(i)})).sort((a,b)=>a.depth-b.depth||a.i-b.i);
  pass.setPipeline(this.transparentPipeline);pass.setBindGroup(0,group);pass.setVertexBuffer(0,this.assemblyVertices);pass.setIndexBuffer(this.assemblyIndices,'uint32');
  for(const {i}of sorted){const d=this.instanceDraws[i];pass.drawIndexed(d.count,1,d.index,d.vertex,i);}
  this.drawEdges(pass,sorted.map(n=>n.i));
 }
 drawEdges(pass,indices){
  if(this.showEdges===false||!this.assemblyEdges||!indices.length)return;
  pass.setPipeline(this.edgePipeline);pass.setIndexBuffer(this.assemblyEdges,'uint32');
  for(let k=0;k<indices.length;k++){const first=indices[k],d=this.instanceDraws[first];let count=1;while(indices[k+1]===first+count&&indices[k+1]<d.firstInstance+d.instances){count++;k++;}if(d.edgeCount)pass.drawIndexed(d.edgeCount,count,d.edgeIndex,d.vertex,first);}
 }
 draw(pass){if(!this.draws)return super.draw(pass);this.drawAssembly(pass);}
 setScene(scene,fit=false){this.deformedParts=new Map();this.draws=null;this.instanceLookup=null;this.materialOpacity=null;super.setScene(scene,fit);}
 setDeformedTopology(changes){
  if(!Object.keys(changes).length)return;
  const definition=this.assemblyDefinition;if(!definition)throw Error('Load assembly before deforming parts');
  if(Object.keys(changes).some(id=>!this.meshSlots.has(id)))throw Error('Unknown deformed prototype');
  const instances=definition.instances.map(n=>{const i=this.instanceLookup.get(n.id);return {...n,transform:[0,1,2].flatMap(r=>[this.placements[i*20+r],this.placements[i*20+4+r],this.placements[i*20+8+r],this.placements[i*20+12+r]])};});
  this.setAssembly({prototypes:definition.prototypes.map(p=>changes[p.id]??p),instances},false);
 }
 setDeformedParts(changes){
  const checked=Object.entries(changes).map(([id,p])=>{const slot=this.meshSlots?.get(id);if(!slot||p.positions.length!==slot.count*3||p.normals.length!==p.positions.length||!p.positions.every(Number.isFinite)||!p.normals.every(Number.isFinite))throw Error('Invalid deformed prototype '+id);return [id,p,slot];});
  for(const [id,p,slot]of checked){
   const data=new Float32Array(slot.count*6),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
   for(let i=0;i<slot.count;i++)for(let k=0;k<3;k++){const x=p.positions[i*3+k];data[i*6+k]=x;data[i*6+k+3]=p.normals[i*3+k];low[k]=Math.min(low[k],x);high[k]=Math.max(high[k],x);}
   this.device.queue.writeBuffer(this.assemblyVertices,slot.vertex*24,data);
   this.deformedParts.set(id,{...slot.part,positions:p.positions,normals:p.normals});
   for(let i=0;i<this.instanceAssets.length;i++)if(this.instanceAssets[i]===id)this.instanceLocalBounds[i]={low,high};
  }
  if(checked.length)this.request();
 }
 async captureView(options={}){
  for(const m of Object.values(options.transforms??{}))checkedTransform(m);
  return captureAssembly(this,options);
 }
}
