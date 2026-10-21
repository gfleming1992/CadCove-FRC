import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const server=Bun.serve({port:0,fetch(request){const p=new URL(request.url).pathname;if(p.startsWith('/src/core/')&&!p.includes('..'))return new Response(Bun.file('.'+p));return new Response('<style>canvas{width:640px;height:480px}</style><canvas tabindex="0"></canvas><div id="status"></div>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
try{
 const page=await browser.newPage();await page.goto(`http://localhost:${server.port}`);
 const result=await page.evaluate(async()=>{
  const {AssemblyViewer}=await import('/src/core/assembly-viewer.js'),{MechanismMotion}=await import('/src/core/mechanism-motion.js');
  const v=await new AssemblyViewer(document.querySelector('canvas')).init();
  const parts=['frame','a','b'].map((id,i)=>({id,color:['#777777','#ff9900','#3399ff'][i],positions:new Float32Array([i*20,0,0,i*20+10,0,0,i*20,10,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])}));
  v.setScene({parts},true);const scene=v.scene,positions=parts.map(p=>p.positions.slice());
  const m=new MechanismMotion(v).load({schema:1,units:'mm-deg',bodies:[{id:'base',fixed:true,origin:[0,0,0],parts:['frame']},...['a','b'].map((id,i)=>({id,fixed:false,origin:[20+i*20,0,0],parts:[id]}))],joints:['a','b'].map((id,i)=>({id:id+'-axis',type:'revolute',parent:'base',child:id,origin:[20+i*20,0,0],axis:[0,0,1]})),relations:[{id:'gears',type:'gear',driver:'a-axis',follower:'b-axis',driverTeeth:20,followerTeeth:40,direction:-1}]});
  m.rotate('a',90);const buffer=v.assemblyVertices;const rotated={...m.angles};
  const frame=await v.captureView({view:'top',width:320,height:240});
  m.animate('a',60,.2);await new Promise(r=>setTimeout(r,300));
  const ended=m.state(),sameBuffer=buffer===v.assemblyVertices;
  m.animate('a',30,2);await new Promise(r=>setTimeout(r,50));m.stop();const stopped=JSON.stringify(m.angles);await new Promise(r=>setTimeout(r,50));const stayed=stopped===JSON.stringify(m.angles);
  m.reset();
  const trajectory={units:'deg-s',tracks:[{target:'a',segments:[{seconds:.1,acceleration:3000},{seconds:.1,acceleration:-3000}]}]};
  m.play(trajectory);const id=m.state().playback.id;m.pause();m.seek(.1);
  const midpoint=m.angles['a-axis'];m.resume();await new Promise(r=>setTimeout(r,180));
  const playback=m.state();m.reset();
  return {midpoint,playback,id,rotated,ended,sameBuffer,stayed,reset:m.angles,png:frame.image.startsWith('data:image/png;base64,'),sameScene:scene===v.scene,unchanged:parts.every((p,i)=>p.positions.every((x,k)=>x===positions[i][k]))};
 });
 assert.equal(result.midpoint,15);assert.equal(result.playback.playback.id,result.id);assert.equal(result.playback.playback.status,'completed');assert.equal(result.playback.angles['a-axis'],30);
 assert.deepEqual(result.rotated,{'a-axis':90,'b-axis':-45});assert.equal(result.ended.running,false);assert.ok(Math.abs(result.ended.angles['a-axis']-162)<1e-5);assert.deepEqual(result.reset,{'a-axis':0,'b-axis':0});for(const k of ['sameBuffer','stayed','png','sameScene','unchanged'])assert.equal(result[k],true,k);
 console.log('PASS: GPU pose-only rotation/animation, gear coupling, stop/reset, capture, unchanged source meshes');
}finally{await browser.close();server.stop(true);}
