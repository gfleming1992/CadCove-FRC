import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.env.CADCOVE_CUT_FIXTURE??'build/cut-fixture';
const data={plan:await Bun.file(root+'/paths.json').json(),scene:await Bun.file(root+'/scene.json').json()};
const server=Bun.serve({port:0,fetch(request){const p=new URL(request.url).pathname;if(p.startsWith('/src/core/')&&!p.includes('..'))return new Response(Bun.file('.'+p));return new Response('<style>body{margin:0}canvas{width:1000px;height:700px}</style><canvas tabindex="0"></canvas>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto(`http://localhost:${server.port}`);
 await page.evaluate(async({plan,scene})=>{
  const {AssemblyViewer}=await import('/src/core/assembly-viewer.js'),{MechanismMotion}=await import('/src/core/mechanism-motion.js'),{installSelection}=await import('/src/core/selection.js'),{createCanvasCommands}=await import('/src/core/canvas-commands.js');
  for(const p of scene.parts){p.positions=new Float32Array(p.positions);p.normals=new Float32Array(p.normals);p.indices=new Uint32Array(p.indices);}
  const viewer=await new AssemblyViewer(document.querySelector('canvas')).init();viewer.setScene(scene,true);
  const selection=installSelection(viewer),motion=new MechanismMotion(viewer),api=createCanvasCommands({viewer,motion,selection,revision:()=> 'rev'});
  window.cutTest={viewer,selection,motion,api,plan:{...plan,sourceRevision:'rev'},errors:[]};viewer.device.addEventListener('uncapturederror',e=>window.cutTest.errors.push(e.error.message));
  api('motion',{action:'play-cut',solution:window.cutTest.plan});api('motion',{action:'seek',seconds:0});
 },data);
 await page.screenshot({path:'build/cut-flat.png'});
 const result=await page.evaluate(async()=>{
  const {viewer:v,motion:m,api}=window.cutTest,scene=v.scene,buffer=v.assemblyVertices,camera=JSON.stringify(v.camera),source=Array.from(scene.parts[0].positions);
  const start=performance.now();for(let t=0;t<=4;t+=.1)api('motion',{action:'seek',seconds:t});const updateMs=(performance.now()-start)/41;
  api('motion',{action:'seek',seconds:m.playback.duration});
  const heights=Array.from(m.surfaces.heights);api('motion',{action:'seek',seconds:0});api('motion',{action:'seek',seconds:m.playback.duration});
  const deterministic=heights.every((x,i)=>x===m.surfaces.heights[i]);
  api('selection',{ids:['stock']});const selected=api('selection');api('selection',{ids:[]});
  await v.device.queue.onSubmittedWorkDone();
  return {deterministic,updateMs,sameCamera:JSON.stringify(v.camera)===camera,sameBuffer:v.assemblyVertices===buffer,sameScene:v.scene===scene,sourceUnchanged:source.every((x,i)=>x===scene.parts[0].positions[i]),selected};
 });
 await page.screenshot({path:'build/cut-finished.png'});
 await page.evaluate(()=>{const {api,motion:m}=window.cutTest;api('motion',{action:'seek',seconds:Math.min(3,m.playback.duration/2)});});
 await page.screenshot({path:'build/cut-active.png'});
 const before=await page.evaluate(()=>({...window.cutTest.viewer.camera}));
 await page.evaluate(()=>{const {api}=window.cutTest;api('motion',{action:'seek',seconds:0});api('motion',{action:'resume'});});
 await page.mouse.move(500,350);await page.mouse.down();await page.mouse.move(540,375,{steps:5});await page.mouse.up();await page.mouse.wheel(0,-80);
 const after=await page.evaluate(()=>({...window.cutTest.viewer.camera}));assert.notDeepEqual(before,after);
 const final=await page.evaluate(()=>{const {api,viewer:v,errors}=window.cutTest;api('motion',{action:'reset'});return {errors,reset:v.assemblyDefinition.prototypes.every(p=>Array.from(p.positions).every((x,i)=>x===v.scene.parts.find(a=>a.id===p.id).positions[i]))};});
 for(const key of ['deterministic','sameCamera','sameBuffer','sameScene','sourceUnchanged'])assert.equal(result[key],true,key);
 assert.equal(final.reset,true);assert.deepEqual(final.errors,[]);
 console.log(JSON.stringify({ok:true,...result,orbitZoomDuringPlayback:true,reset:true,webgpuErrors:final.errors}));
}finally{await browser.close();server.stop(true);}
