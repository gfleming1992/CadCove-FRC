import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const file=process.env.CADCOVE_SOLVED_FIXTURE;if(!file)throw Error('Set CADCOVE_SOLVED_FIXTURE to an actual native solver result');
const solution=await Bun.file(file).json();
const server=Bun.serve({port:0,fetch(request){const p=new URL(request.url).pathname;if(p.startsWith('/src/core/')&&!p.includes('..'))return new Response(Bun.file('.'+p));return new Response('<style>canvas{width:640px;height:480px}</style><canvas></canvas>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
try{
 const page=await browser.newPage();await page.goto(`http://localhost:${server.port}`);
 const result=await page.evaluate(async solution=>{
  const {AssemblyViewer}=await import('/src/core/assembly-viewer.js'),{MechanismMotion}=await import('/src/core/mechanism-motion.js'),{createCanvasCommands}=await import('/src/core/canvas-commands.js');
  const viewer=await new AssemblyViewer(document.querySelector('canvas')).init();
  const parts=solution.bodies.map((body,i)=>{
   body.parts=[body.id];const m=body.pose,length=i===0||i===2?100:50;
   const positions=new Float32Array([[0,-3,0],[length,-3,0],[length,3,0],[0,3,0]].flatMap(v=>[0,1,2].map(r=>m[r]*v[0]+m[4+r]*v[1]+m[8+r]*v[2]+m[12+r])));
   return {id:body.id,positions,normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2,0,2,3]),color:['#777777','#ee8822','#22aaff','#dd4488'][i]};
  });
  solution.sourceRevision='test-source';viewer.setScene({parts},true);const scene=viewer.scene;
  const motion=new MechanismMotion(viewer),command=createCanvasCommands({viewer,motion,selection:{},revision:()=> 'test-source'});
  command('motion',{action:'play-solved',solution});command('motion',{action:'pause'});const buffer=viewer.assemblyVertices;
  command('motion',{action:'seek',seconds:solution.frames.at(-1).time});
  const frame=await viewer.captureView({view:'top',width:640,height:480});
  const unchanged=buffer===viewer.assemblyVertices&&scene===viewer.scene;
  command('motion',{action:'reset'});command('motion',{action:'play-solved',solution});
  await new Promise(r=>setTimeout(r,1300));
  return {unchanged,png:frame.image,status:motion.state().playback.status,kind:motion.state().playback.kind,sameBuffer:buffer===viewer.assemblyVertices};
 },solution);
 assert.equal(result.unchanged,true);assert.equal(result.sameBuffer,true);assert.equal(result.status,'completed');assert.equal(result.kind,'solved');
 if(process.env.CADCOVE_SOLVED_SCREENSHOT)await Bun.write(process.env.CADCOVE_SOLVED_SCREENSHOT,Buffer.from(result.png.split(',')[1],'base64'));
 console.log('PASS: actual Ondsel four-bar output plays in WebGPU; pause/seek/reset; unchanged scene and vertex buffer');
}finally{await browser.close();server.stop(true);}
