import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.env.CADCOVE_FOLD_FIXTURE??'build/fold-browser-fixture/base';
const data={definition:await Bun.file(root+'/fold-definition.json').json(),scene:await Bun.file(root+'/mesh.json').json()};
const server=Bun.serve({port:0,fetch(request){const p=new URL(request.url).pathname;if(p.startsWith('/src/core/')&&!p.includes('..'))return new Response(Bun.file('.'+p));return new Response('<style>body{margin:0}canvas{width:900px;height:650px}</style><canvas tabindex="0"></canvas>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
try{
 const page=await browser.newPage({viewport:{width:900,height:650}});await page.goto(`http://localhost:${server.port}`);
 await page.evaluate(async({definition,scene})=>{
  const {AssemblyViewer}=await import('/src/core/assembly-viewer.js'),{MechanismMotion}=await import('/src/core/mechanism-motion.js'),{installSelection}=await import('/src/core/selection.js'),{createCanvasCommands}=await import('/src/core/canvas-commands.js');
  for(const p of scene.parts){p.positions=new Float32Array(p.positions);p.normals=new Float32Array(p.normals);p.indices=new Uint32Array(p.indices);}
  const viewer=await new AssemblyViewer(document.querySelector('canvas')).init();viewer.setScene(scene,true);
  const selection=installSelection(viewer),motion=new MechanismMotion(viewer),api=createCanvasCommands({viewer,motion,selection,revision:()=> 'rev'});
  const plan={schema:1,sourceRevision:'rev',definition,tracks:definition.bends.map((b,i)=>({bend:b.id,startSeconds:i,seconds:1})),holdSeconds:1};
  window.foldTest={viewer,selection,motion,api,plan,errors:[]};viewer.device.addEventListener('uncapturederror',e=>window.foldTest.errors.push(e.error.message));
  api('motion',{action:'play-fold',solution:plan});api('motion',{action:'seek',seconds:0});
 },data);
 await page.screenshot({path:'build/fold-flat.png'});
 const checks=await page.evaluate(async()=>{
  const {viewer:v,motion:m,api}=window.foldTest,scene=v.scene,buffer=v.assemblyVertices,source=Array.from(scene.parts[1].positions),camera=JSON.stringify(v.camera);
  api('selection',{ids:[scene.parts[1].id]});api('motion',{action:'seek',seconds:1.5});
  const changed=Array.from(v.deformedParts.get(scene.parts[1].id).positions);
  api('motion',{action:'seek',seconds:0});api('motion',{action:'seek',seconds:1.5});
  const deterministic=changed.every((x,i)=>x===v.deformedParts.get(scene.parts[1].id).positions[i]);
  const start=performance.now();for(let i=0;i<30;i++)api('motion',{action:'seek',seconds:i/15});
  const seekMs=(performance.now()-start)/30;
  api('selection',{ids:[]});api('motion',{action:'seek',seconds:2});
  await v.device.queue.onSubmittedWorkDone();
  return {deterministic,seekMs,sameCamera:JSON.stringify(v.camera)===camera,sameBuffer:v.assemblyVertices===buffer,sameScene:v.scene===scene,sourceUnchanged:source.every((x,i)=>x===scene.parts[1].positions[i])};
 });
 await page.screenshot({path:'build/fold-folded.png'});
 const before=await page.evaluate(()=>({...window.foldTest.viewer.camera}));
 await page.evaluate(()=>{window.foldTest.api('motion',{action:'seek',seconds:0});window.foldTest.api('motion',{action:'resume'});});
 await page.mouse.move(450,325);await page.mouse.down();await page.mouse.move(520,355,{steps:5});await page.mouse.up();await page.mouse.wheel(0,-120);
 const after=await page.evaluate(()=>({...window.foldTest.viewer.camera}));assert.notDeepEqual(before,after);
 await page.waitForFunction(()=>window.foldTest.motion.state().playback.status==='completed');
 const final=await page.evaluate(()=>{const {api,viewer:v,errors}=window.foldTest;api('motion',{action:'reset'});return {errors,reset:v.assemblyDefinition.prototypes.every(p=>Array.from(p.positions).every((x,i)=>x===v.scene.parts.find(a=>a.id===p.id).positions[i]))};});
 for(const key of ['deterministic','sameCamera','sameBuffer','sameScene','sourceUnchanged'])assert.equal(checks[key],true,key);
 assert.equal(final.reset,true);assert.deepEqual(final.errors,[]);
 console.log(JSON.stringify({ok:true,...checks,orbitZoomDuringPlayback:true,reset:true,webgpuErrors:final.errors}));
}finally{await browser.close();server.stop(true);}
