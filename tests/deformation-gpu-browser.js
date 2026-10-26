// Synthetic surface test: validates rendering mathematics, not ball physics.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import path from 'node:path';
const root=process.cwd(),server=Bun.serve({port:0,fetch(request){const p=new URL(request.url).pathname;if(['/web/','/vendor/cad-core/src/core/'].some(prefix=>p.startsWith(prefix))&&!p.includes('..'))return new Response(Bun.file(path.join(root,p)),{headers:{'content-type':'text/javascript'}});return new Response('<style>canvas{width:640px;height:480px}</style><canvas></canvas>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
try{
 const page=await browser.newPage();await page.goto(`http://localhost:${server.port}`);
 const result=await page.evaluate(async()=>{
  const {AssemblyViewer}=await import('/vendor/cad-core/src/core/assembly-viewer.js'),{GpuDeformation,createDeformationPrototype}=await import('/web/deformation-gpu.js');
  const v=await new AssemblyViewer(document.querySelector('canvas')).init(),errors=[];v.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const topology={surfaceVertexCount:6,centerParticleIndex:6,indices:[0,2,4,2,1,4,1,3,4,3,0,4,2,0,5,1,2,5,3,1,5,0,3,5]};
  const a=[[.075,0,0],[-.075,0,0],[0,.075,0],[0,-.075,0],[0,0,.075],[0,0,-.075],[0,0,0]],b=a.map(([x,y,z])=>[x*.4,y*1.2,z*.8+.015]);
  const part=createDeformationPrototype('ball',topology,a),cad={id:'cad',name:'Unchanged CAD',color:'#336699',positions:new Float32Array([100,-30,0,160,-30,0,130,30,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])},identity=[1,0,0,0,0,1,0,0,0,0,1,0];
  // Ball after CAD ensures copies honor a nonzero mesh vertex offset.
  v.setAssembly({prototypes:[cad,part],instances:[{id:'cad',asset:'cad',color:cad.color,transform:identity},{id:'ball',asset:'ball',color:part.color,transform:identity}]});
  const buffers=[v.assemblyVertices,v.assemblyIndices,v.assemblyInstances],cpuGeometry=[...part.positions],camera=JSON.stringify(v.camera),adapter=await GpuDeformation.create(v,'ball',topology);
  const fixedCamera={target:[0,0,0],distance:300,yaw:1,pitch:1};
  const cadBefore=await v.captureView({ids:['cad'],width:160,height:120});
  adapter.update({particlesA:a});const rigid=await v.captureView({ids:['ball'],camera:fixedCamera,width:320,height:240});
  adapter.update({particlesA:a,particlesB:b,alpha:.5});const readback=Array.from(await adapter.readback()),deformed=await v.captureView({ids:['ball'],camera:fixedCamera,width:320,height:240});
  const cadAfter=await v.captureView({ids:['cad'],width:160,height:120});
  const expected=a.slice(0,6).map((p,i)=>p.map((n,k)=>(n+b[i][k])*500));
  let positionError=0,normalError=0;
  for(let i=0;i<6;i++){
   let normal=[0,0,0];for(let t=0;t<topology.indices.length;t+=3){const tri=topology.indices.slice(t,t+3);if(!tri.includes(i))continue;const [p,q,r]=tri.map(j=>expected[j]),u=q.map((n,k)=>n-p[k]),w=r.map((n,k)=>n-p[k]),cross=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];normal=normal.map((n,k)=>n+cross[k]);}
   const length=Math.hypot(...normal);normal=normal.map(n=>n/length);
   for(let k=0;k<3;k++){positionError=Math.max(positionError,Math.abs(readback[i*6+k]-expected[i][k]));normalError=Math.max(normalError,Math.abs(readback[i*6+3+k]-normal[k]));}
  }
  const rejects=[];const reject=(name,fn)=>{try{fn();rejects.push([name,false]);}catch{rejects.push([name,true]);}};
  reject('alpha',()=>adapter.update({particlesA:a,alpha:1.1}));
  reject('length',()=>adapter.update({particlesA:a.slice(0,6)}));
  reject('nonfinite',()=>adapter.update({particlesA:a.map((p,i)=>i===0?[NaN,0,0]:p)}));
  reject('range',()=>adapter.update({particlesA:a.map((p,i)=>i===0?[1e10,0,0]:p)}));
  reject('conversion overflow',()=>createDeformationPrototype('bad',topology,a,'#e9bd48',{scale:1e300}));
  reject('topology index',()=>createDeformationPrototype('bad',{...topology,indices:[0,2,6]},a));
  reject('fractional index',()=>createDeformationPrototype('bad',{...topology,indices:[0,2,2.5]},a));
  const before=adapter.stats;for(let i=0;i<12;i++)adapter.update({particlesA:a,particlesB:b,alpha:i/12});await v.device.queue.onSubmittedWorkDone();
  const reusedUploads=adapter.stats.particleUploads===before.particleUploads;
  const retained=buffers.every((n,i)=>n===[v.assemblyVertices,v.assemblyIndices,v.assemblyInstances][i]),cpuUnchanged=cpuGeometry.every((n,i)=>n===part.positions[i]),cameraUnchanged=camera===JSON.stringify(v.camera);
  // Collapsed triangles get a finite fallback normal, not NaNs.
  adapter.update({particlesA:a.map(()=>[0,0,0])});const collapsed=Array.from(await adapter.readback());
  // Prototype identity must reject topology replacement, even same vertex count.
  v.setAssembly(v.assemblyDefinition,false);reject('stale adapter',()=>adapter.update({particlesA:a}));adapter.dispose();reject('disposed adapter',()=>adapter.update({particlesA:a}));const disposed=adapter.stats.gpuBytes===0&&adapter.stats.disposed;
  // 162 surface vertices / 320 triangles: representative small particle mesh.
  const particles=[[0,0,.075]],indices=[],rings=10,sides=16;
  for(let j=1;j<=rings;j++)for(let i=0;i<sides;i++){const p=Math.PI*j/(rings+1),t=2*Math.PI*i/sides;particles.push([.075*Math.sin(p)*Math.cos(t),.075*Math.sin(p)*Math.sin(t),.075*Math.cos(p)]);}
  const bottom=particles.length;particles.push([0,0,-.075]);
  for(let i=0;i<sides;i++)indices.push(0,1+i,1+(i+1)%sides);
  for(let j=0;j<rings-1;j++)for(let i=0;i<sides;i++){const p=1+j*sides+i,q=1+j*sides+(i+1)%sides;indices.push(p,p+sides,q,q,p+sides,q+sides);}
  for(let i=0;i<sides;i++)indices.push(bottom,1+(rings-1)*sides+(i+1)%sides,1+(rings-1)*sides+i);
  const benchTopology={surfaceVertexCount:particles.length,indices},mesh=createDeformationPrototype('bench',benchTopology,particles),compressed=particles.map(([x,y,z])=>[x*.65,y,z]);
  v.setAssembly({prototypes:[mesh],instances:[{id:'bench',asset:'bench',color:mesh.color,transform:identity}]},false);const bench=await GpuDeformation.create(v,'bench',benchTopology);
  bench.update({particlesA:particles,particlesB:compressed,alpha:0});await v.device.queue.onSubmittedWorkDone();
  const start=performance.now();for(let i=0;i<120;i++)bench.update({particlesA:particles,particlesB:compressed,alpha:(i%60)/60});const enqueueMs=performance.now()-start;await v.device.queue.onSubmittedWorkDone();const completeMs=performance.now()-start,stats=bench.stats;bench.dispose();v.device.destroy();
  return {positionError,normalError,imageChanged:rigid.image!==deformed.image,cadImageUnchanged:cadBefore.image===cadAfter.image,retained,cpuUnchanged,cameraUnchanged,reusedUploads,rejects,collapsedFinite:collapsed.every(Number.isFinite),disposed,errors,syntheticBenchmark:{frames:120,enqueueMs,completeMs,stats}};
 });
 assert.ok(result.positionError<.0001,JSON.stringify(result));assert.ok(result.normalError<.00001);for(const key of ['imageChanged','cadImageUnchanged','retained','cpuUnchanged','cameraUnchanged','reusedUploads','collapsedFinite','disposed'])assert.equal(result[key],true,key);for(const [name,rejected]of result.rejects)assert.equal(rejected,true,name);assert.deepEqual(result.errors,[]);assert.equal(result.syntheticBenchmark.stats.particleUploads,2);
 console.log(JSON.stringify({ok:true,scope:'Synthetic GPU presentation correctness, not physics validation or a full-scene FPS benchmark',checks:result}));
}finally{await browser.close();server.stop(true);}
