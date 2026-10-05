// Optional generic assembly renderer. CAD sources/caches stay immutable while
// applications animate placements. No physics or domain dependency lives here.
import {Viewer} from './viewer.js';
import {captureAssembly} from './assembly-capture.js';
export const ASSEMBLY_VIEW_API_VERSION = 1;
const identity=[1,0,0,0,0,1,0,0,0,0,1,0];
const shader=`
struct View {mvp:mat4x4f};
struct Instance {matrix:mat4x4f,color:vec4f};
@group(0) @binding(0) var<uniform> view:View;
@group(0) @binding(1) var<storage,read> instances:array<Instance>;
struct Out {@builtin(position) position:vec4f,@location(0) normal:vec3f,@location(1) color:vec3f};
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@builtin(instance_index) index:u32)->Out {
 let i=instances[index];var o:Out;o.position=view.mvp*i.matrix*vec4f(p,1);
 o.normal=(i.matrix*vec4f(n,0)).xyz;o.color=i.color.rgb;return o;
}
@fragment fn fs(o:Out,@builtin(front_facing) front:bool)->@location(0) vec4f {
 let n=normalize(o.normal)*select(-1.0,1.0,front);
 let key=max(dot(n,normalize(vec3f(-0.3,-0.6,1.0))),0.0);
 let fill=max(dot(n,normalize(vec3f(0.8,0.4,0.2))),0.0);
 let linear=pow(o.color,vec3f(2.2))*(0.42+0.55*key+0.18*fill);
 return vec4f(pow(linear,vec3f(1.0/2.2)),1);
}`;
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
  this.assemblyPipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'}]}]},fragment:{module,entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'greater'},multisample:{count:4}});
  return this;
 }
 setAssembly({prototypes,instances},fit=true){
  if(!instances.length)throw Error('Empty assembly');
  const library=new Map(prototypes.map(p=>[p.id,p])),groups=new Map(),seen=new Set();
  if(library.size!==prototypes.length)throw Error('Duplicate prototype');
  for(const n of instances){
   if(seen.has(n.id)||!library.has(n.asset))throw Error('Duplicate instance or missing prototype: '+n.id);
   seen.add(n.id);checkedTransform(n.transform);
   if(!/^#[0-9a-f]{6}$/i.test(n.color))throw Error('Invalid instance color');
   if(!groups.has(n.asset))groups.set(n.asset,[]);groups.get(n.asset).push(n);
  }
  let vertices=0,indices=0;for(const asset of groups.keys()){const p=library.get(asset);vertices+=p.positions.length/3;indices+=p.indices.length;}
  const data=new Float32Array(vertices*6),indexData=new Uint32Array(indices),placements=new Float32Array(instances.length*20);
  const draws=[],lookup=new Map(),localBounds=[],low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  let vertex=0,index=0,instance=0;
  for(const [asset,nodes] of groups){
   const p=library.get(asset),start=instance;
   if(p.normals.length!==p.positions.length||!p.positions.every(Number.isFinite)||!p.normals.every(Number.isFinite)||p.indices.some(i=>i>=p.positions.length/3))throw Error('Invalid prototype mesh');
   const localMin=[Infinity,Infinity,Infinity],localMax=[-Infinity,-Infinity,-Infinity];
   for(let v=0;v<p.positions.length/3;v++)for(let k=0;k<3;k++){const x=p.positions[v*3+k];data[(vertex+v)*6+k]=x;data[(vertex+v)*6+3+k]=p.normals[v*3+k];localMin[k]=Math.min(localMin[k],x);localMax[k]=Math.max(localMax[k],x);}
   indexData.set(p.indices,index);
   for(const n of nodes){
    const m=n.transform??identity;writeMatrix(placements,instance*20,m);
    placements.set([1,3,5].map(i=>parseInt(n.color.slice(i,i+2),16)/255).concat(1),instance*20+16);
    localBounds.push({low:localMin,high:localMax});lookup.set(n.id,instance++);
    for(let corner=0;corner<8;corner++){const pt=[0,1,2].map(k=>(corner>>k)&1?localMax[k]:localMin[k]);for(let r=0;r<3;r++){const x=m[r*4+3]+pt.reduce((s,v,k)=>s+v*m[r*4+k],0);low[r]=Math.min(low[r],x);high[r]=Math.max(high[r],x);}}
   }
   draws.push({count:p.indices.length,index,vertex,firstInstance:start,instances:nodes.length});vertex+=p.positions.length/3;index+=p.indices.length;
  }
  if(!vertices||!indices)throw Error('Assembly has no geometry');
  const create=(array,usage)=>{const b=this.device.createBuffer({size:array.byteLength,usage:usage|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(b,0,array);return b;};
  const vb=create(data,GPUBufferUsage.VERTEX),ib=create(indexData,GPUBufferUsage.INDEX),sb=create(placements,GPUBufferUsage.STORAGE);
  this.assemblyVertices?.destroy();this.assemblyIndices?.destroy();this.assemblyInstances?.destroy();
  this.assemblyVertices=vb;this.assemblyIndices=ib;this.assemblyInstances=sb;this.placements=placements;this.instanceLookup=lookup;this.instanceLocalBounds=localBounds;this.draws=draws;
  this.assemblyGroup=this.device.createBindGroup({layout:this.assemblyPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}},{binding:1,resource:{buffer:sb}}]});
  this.bounds={low,high};this.center=low.map((x,i)=>(x+high[i])/2);this.radius=Math.max(Math.hypot(...high.map((x,i)=>x-low[i]))/2,.001);
  this.gpuBytes=data.byteLength+indexData.byteLength+placements.byteLength;this.instanceCount=instances.length;
  if(fit)this.fit();this.request();
 }
 setTransforms(changes){
  const checked=Object.entries(changes).map(([id,m])=>{if(!this.instanceLookup?.has(id))throw Error('Unknown instance '+id);return [this.instanceLookup.get(id),checkedTransform(m)];});
  if(!checked.length)return;
  let first=Infinity,last=0;for(const [i,m] of checked){writeMatrix(this.placements,i*20,m);first=Math.min(first,i);last=Math.max(last,i);}
  this.device.queue.writeBuffer(this.assemblyInstances,first*80,this.placements.subarray(first*20,(last+1)*20));this.request();
 }
 draw(pass){
  if(!this.draws)return super.draw(pass);
  pass.setPipeline(this.assemblyPipeline);pass.setBindGroup(0,this.assemblyGroup);pass.setVertexBuffer(0,this.assemblyVertices);pass.setIndexBuffer(this.assemblyIndices,'uint32');
  for(const d of this.draws)pass.drawIndexed(d.count,d.instances,d.index,d.vertex,d.firstInstance);
 }
 setScene(scene,fit=false){this.draws=null;super.setScene(scene,fit);}
 async captureView(options={}){
  for(const m of Object.values(options.transforms??{}))checkedTransform(m);
  return captureAssembly(this,options);
 }
}
