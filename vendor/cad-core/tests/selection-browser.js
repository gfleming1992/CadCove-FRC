import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const server=Bun.serve({port:0,fetch(request){const p=new URL(request.url).pathname;if(p.startsWith('/src/core/')&&!p.includes('..'))return new Response(Bun.file('.'+p));return new Response('<style>canvas{width:640px;height:480px}</style><canvas tabindex="0"></canvas><div id="status"></div>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
try{
 const page=await browser.newPage();await page.goto(`http://localhost:${server.port}`);
 await page.evaluate(async()=>{
  const {AssemblyViewer}=await import('/src/core/assembly-viewer.js'),{installSelection}=await import('/src/core/selection.js');
  const v=await new AssemblyViewer(document.querySelector('canvas')).init();
  const p={id:'shaft',name:'Shaft',color:'#336699',positions:new Float32Array([-2,-2,0,2,-2,0,0,2,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])};
  window.v=v;window.p=p;window.selection=installSelection(v);v.setScene({parts:[p]},true);v.camera={target:[0,0,0],distance:10,yaw:0,pitch:.001};v.request();window.buffers=v.batches.map(b=>b?.vertices);
 });
 await page.mouse.click(328,248);
 assert.deepEqual(await page.evaluate(()=>selection.state().selectedIds),['shaft']);
 assert.equal(await page.evaluate(()=>v.batches.every((b,i)=>b?.vertices===buffers[i])&&p.color==='#336699'),true);
 await page.mouse.move(328,248);await page.mouse.down();await page.mouse.move(380,248);await page.mouse.up();
 assert.deepEqual(await page.evaluate(()=>selection.state().selectedIds),['shaft']);
 await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>selection.state().selectedIds),[]);
 await page.evaluate(()=>{v.camera={target:[0,0,0],distance:10,yaw:0,pitch:.001};selection.set(['shaft']);v.setScene({parts:[p]});});
 assert.deepEqual(await page.evaluate(()=>selection.state().selectedIds),['shaft']);
 await page.evaluate(()=>{v.setAssembly({prototypes:[p],instances:[{id:'shaft',asset:'shaft',color:p.color,transform:[1,0,0,0,0,1,0,0,0,0,1,0]}]},false)});
 const neutral=await page.evaluate(async()=>{const a=await v.captureView({view:'top'});selection.set([]);const b=await v.captureView({view:'top'});return a.image===b.image});assert.equal(neutral,true);
 await page.mouse.click(328,248);assert.deepEqual(await page.evaluate(()=>selection.state().selectedIds),['shaft']);
 await page.keyboard.down('Control');await page.mouse.click(328,248);await page.keyboard.up('Control');assert.deepEqual(await page.evaluate(()=>selection.state().selectedIds),[]);
 await page.evaluate(()=>v.setTransforms({shaft:[1,0,0,8,0,1,0,0,0,0,1,0]}));
 await page.mouse.click(328,248);assert.deepEqual(await page.evaluate(()=>selection.state().selectedIds),[]);
 console.log('PASS: click, toggle, drag, Escape, rebuild, moving instances, neutral captures, unchanged geometry');
}finally{await browser.close();server.stop(true);}
