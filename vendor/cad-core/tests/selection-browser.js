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
 // Agent highlights use renderer colors and stay independent of user selection.
 await page.evaluate(()=>{selection.set([]);selection.setHighlights([{id:'shaft'}]);});
 assert.equal(await page.evaluate(()=>selection.state().highlights[0].color),'#24c8e5');
 const rgba=await page.evaluate(()=>Array.from(v.placements.slice(16,19)));
 assert(Math.abs(rgba[0]-36/255)<1e-6 && Math.abs(rgba[1]-200/255)<1e-6);
 await page.evaluate(()=>selection.set(['shaft']));
 assert.equal(await page.evaluate(()=>v.placements[16]),1); // User selection remains yellow.
 await page.evaluate(()=>selection.set([]));assert.deepEqual(await page.evaluate(()=>Array.from(v.placements.slice(16,19))),rgba);
 await page.evaluate(()=>v.setTransforms({shaft:[1,0,0,10,0,1,0,0,0,0,1,0]}));
 assert.deepEqual(await page.evaluate(()=>Array.from(v.placements.slice(16,19))),rgba);
 await page.evaluate(()=>{try{selection.setHighlights([{id:'missing'}]);}catch{}});
 assert.equal(await page.evaluate(()=>selection.state().highlights.length),1);
 const neutralHighlight=await page.evaluate(async()=>{const a=await v.captureView({view:'top'});selection.setHighlights([]);const b=await v.captureView({view:'top'});return a.image===b.image});assert.equal(neutralHighlight,true);
 await page.evaluate(()=>{v.setAssembly({prototypes:[p],instances:[{id:'shaft',asset:'shaft',color:p.color,transform:[1,0,0,0,0,1,0,0,0,0,1,0]},{id:'second',asset:'shaft',color:p.color,transform:[1,0,0,6,0,1,0,0,0,0,1,0]}]},false);selection.setHighlights([{id:'shaft'},{id:'second',color:'#e95dca'}]);});
 assert.equal(await page.evaluate(()=>selection.state().highlights.length),2);
 await page.locator('canvas').focus();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>selection.state().highlights.length),0);
 await page.evaluate(()=>{selection.setHighlights([{id:'shaft'}]);v.setScene({parts:[p]},false);});assert.equal(await page.evaluate(()=>selection.state().highlights.length),0);
 // Camera API fits exact parts, follows moved bounds, and validates atomically.
 const cam=await page.evaluate(()=>selection.view({ids:['shaft'],view:'front'}).camera);
 assert.equal(cam.yaw,-Math.PI/2);assert(Math.abs(cam.target[0])<1e-6);
 const zoomed=await page.evaluate(()=>selection.view({pan:[3,4,5],zoom:.5}).camera);
 assert.deepEqual(zoomed.target,cam.target.map((v,i)=>v+[3,4,5][i]));assert.equal(zoomed.distance,cam.distance*.5);
 const invalidUnchanged=await page.evaluate(()=>{const before=JSON.stringify(v.camera);for(const options of [{ids:['missing']},{zoom:0},{camera:{pitch:0}},{pan:[0,NaN,0]},{view:'unknown'}]){try{selection.view(options);return false;}catch{if(JSON.stringify(v.camera)!==before)return false;}}return true;});assert(invalidUnchanged);
 await page.evaluate(()=>{v.setAssembly({prototypes:[p],instances:[{id:'shaft',asset:'shaft',color:p.color,transform:[1,0,0,12,0,1,0,0,0,0,1,0]}]},false);selection.setHighlights([{id:'shaft'}]);});
 assert.equal(await page.evaluate(()=>selection.view({ids:['shaft']}).camera.target[0]),12);
 assert.equal(await page.evaluate(()=>selection.state().highlights.length),1);
 // Reveal draws only the target, restores on stop/completion, and keeps camera/colors.
 await page.evaluate(()=>{v.setAssembly({prototypes:[p],instances:[{id:'shaft',asset:'shaft',color:p.color,transform:[1,0,0,0,0,1,0,0,0,0,1,0]},{id:'cover',asset:'shaft',color:p.color,transform:[1,0,0,0,0,1,0,0,0,0,1,1]}]},false);selection.setHighlights([{id:'shaft'}]);window.revealCamera=JSON.stringify(v.camera);selection.startReveal({cycles:1,intervalMs:500});});
 const drawCounts=()=>page.evaluate(()=>{const calls=[];v.draw({setPipeline(){},setBindGroup(){},setVertexBuffer(){},setIndexBuffer(){},drawIndexed(...a){calls.push(a)}});return calls;});
 assert.equal((await drawCounts()).reduce((n,c)=>n+c[1],0),1);
 assert.equal(await page.evaluate(()=>selection.state().reveal.isolated),true);
 await page.waitForFunction(()=>!selection.state().reveal.running);
 assert.equal((await drawCounts()).reduce((n,c)=>n+c[1],0),2);
 assert.equal(await page.evaluate(()=>JSON.stringify(v.camera)===revealCamera&&selection.state().highlights.length===1),true);
 await page.evaluate(()=>selection.startReveal({cycles:3,intervalMs:500}));await page.locator('canvas').focus();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>selection.state().reveal.running),false);
 // Persistent hide/isolate targets current selection or exact names and restores after reveal.
 await page.evaluate(()=>{selection.set(['cover']);selection.visibility({action:'hide'});});
 assert.deepEqual(await page.evaluate(()=>selection.state().hiddenIds),['cover']);
 assert.equal((await drawCounts()).reduce((n,c)=>n+c[1],0),1);
 assert.equal(await page.evaluate(()=>{const before=JSON.stringify(selection.state());try{selection.visibility({action:'isolate',names:['Missing']});return false;}catch{return JSON.stringify(selection.state())===before;}}),true);
 await page.evaluate(()=>{selection.visibility({action:'isolate',ids:['cover']});selection.setHighlights([{id:'shaft'}]);});
 assert.deepEqual(await page.evaluate(()=>selection.state().hiddenIds),['shaft']);
 assert.equal(await page.evaluate(()=>selection.startReveal().reveal.cycles),2);
 await page.evaluate(()=>selection.stopReveal());
 assert.deepEqual(await page.evaluate(()=>selection.state().hiddenIds),['shaft']);
 assert.equal((await drawCounts())[0][4],1);
 await page.evaluate(()=>selection.visibility({action:'show',names:['sHaFt']}));
 assert.deepEqual(await page.evaluate(()=>selection.state().hiddenIds),[]); // Both occurrences share the exact name.
 await page.evaluate(()=>{selection.visibility({action:'hide',ids:['shaft','cover']});});
 assert.equal((await drawCounts()).length,0);
 await page.locator('canvas').focus();await page.keyboard.press('Escape');
 assert.deepEqual(await page.evaluate(()=>selection.state().hiddenIds),[]);
 // Non-instanced path uses each part's index range without rebuilding buffers.
 await page.evaluate(()=>{v.setScene({parts:[p,{...p,id:'cover'}]},false);selection.startReveal({ids:['shaft'],cycles:1,intervalMs:500});});assert.equal((await drawCounts()).length,1);
 await page.evaluate(()=>{selection.visibility({action:'hide',ids:['cover']});});assert.equal((await drawCounts()).length,1);
 await page.evaluate(()=>v.setScene({parts:[p]},false));assert.deepEqual(await page.evaluate(()=>selection.state().hiddenIds),[]);assert.equal(await page.evaluate(()=>selection.state().reveal.running),false);
 // Opacity is agent-addressable, keeps selected colors independent, survives
 // placement updates and captures, and restores without touching CAD buffers.
 await page.evaluate(async()=>{
  const {createCanvasCommands}=await import('/src/core/canvas-commands.js');
  const back={...p,id:'back',color:'#ff0000'},front={...p,id:'front',color:'#0000ff'};
  v.setScene({parts:[back,front]},false);v.setAssembly({prototypes:[back,front],instances:[{id:'back',asset:'back',color:back.color,transform:[1,0,0,0,0,1,0,0,0,0,1,0]},{id:'front',asset:'front',color:front.color,transform:[1,0,0,0,0,1,0,0,0,0,1,1]}]},false);
  v.camera={target:[0,0,0],distance:10,yaw:0,pitch:.001};window.alphaBuffer=v.assemblyVertices;window.cmd=createCanvasCommands({viewer:v,selection,motion:{state:()=>({})}});
  window.pixel=async()=>{const c=await v.captureView({camera:v.camera,width:128,height:128}),img=new Image();img.src=c.image;await img.decode();const cvs=document.createElement('canvas');cvs.width=cvs.height=128;const ctx=cvs.getContext('2d');ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(64,64,1,1).data);};
 });
 const solid=await page.evaluate(()=>pixel());
 await page.evaluate(()=>cmd('opacity',{action:'set',scope:'except',ids:['back'],value:.25}));
 const faded=await page.evaluate(()=>pixel());
 assert(solid[2]>solid[0]+100);assert(faded[0]>solid[0]+80&&faded[2]<solid[2]-80);
 assert.deepEqual(await page.evaluate(()=>cmd('opacity',{action:'state'}).parts),[{id:'front',opacity:.25}]);
 await page.evaluate(()=>{selection.set(['front']);v.setTransforms({front:[1,0,0,0,0,1,0,0,0,0,1,1.5]});});
 assert.equal(await page.evaluate(()=>v.placements[v.instanceLookup.get('front')*20+19]),.25);
 assert.equal(await page.evaluate(()=>v.assemblyVertices===alphaBuffer),true);
 assert.equal(await page.evaluate(()=>{const before=JSON.stringify(selection.state());for(const a of [{action:'set',ids:['missing'],value:.5},{action:'set',ids:['front'],value:2},{action:'set',scope:'all',ids:['front'],value:.5}]){try{cmd('opacity',a);return false;}catch{if(JSON.stringify(selection.state())!==before)return false;}}return true;}),true);
 await page.evaluate(()=>{selection.set([]);cmd('opacity',{action:'set',ids:['front'],value:0});});const invisible=await page.evaluate(()=>pixel());assert(invisible[0]>200&&invisible[2]<10);
 await page.evaluate(()=>cmd('opacity',{action:'reset',scope:'all'}));assert.deepEqual(await page.evaluate(()=>selection.state().opacity.parts),[]);
 await page.evaluate(()=>{cmd('opacity',{action:'set',scope:'all',value:.5});v.setScene({parts:[p]},false);});assert.deepEqual(await page.evaluate(()=>selection.state().opacity.parts),[]);
 console.log('PASS: click, toggle, drag, Escape, rebuild, moving instances, neutral captures, multi-part agent colors, selection priority, atomic validation, motion, rebuild clearing, unchanged geometry');
}finally{await browser.close();server.stop(true);}
