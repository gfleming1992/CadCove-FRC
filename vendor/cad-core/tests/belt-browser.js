import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const server=Bun.serve({port:0,fetch(request){const p=new URL(request.url).pathname;if(p.startsWith('/src/core/')&&!p.includes('..'))return new Response(Bun.file('.'+p));return new Response('<style>canvas{width:640px;height:480px}</style><canvas tabindex="0"></canvas>',{headers:{'content-type':'text/html'}});}});
const browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined,args:['--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});
const solved=process.env.CADCOVE_SOLVED_BELT_FIXTURE?await Bun.file(process.env.CADCOVE_SOLVED_BELT_FIXTURE).json():null;
try{
 const page=await browser.newPage();await page.goto(`http://localhost:${server.port}`);
 const result=await page.evaluate(async solved=>{
  const {AssemblyViewer}=await import('/src/core/assembly-viewer.js'),{MechanismMotion}=await import('/src/core/mechanism-motion.js'),{installSelection}=await import('/src/core/selection.js'),{createCanvasCommands}=await import('/src/core/canvas-commands.js'),{openBeltPath,sampleBeltPath}=await import('/src/core/belt-motion.js');
  const v=await new AssemblyViewer(document.querySelector('canvas')).init(),selection=installSelection(v),pulleys=[0,50].map(x=>({centerMm:[x,0,0],pitchRadiusMm:10})),path=openBeltPath(pulleys,[0,0,1]),positions=[],normals=[],indices=[];
  // Existing toothed surface; intentional long face triangles exercise refinement.
  for(let i=0;i<80;i++){const f=sampleBeltPath(path,path.length*i/80),h=i%4===0?2:0;for(const w of [-3,3]){positions.push(...f.point.map((x,k)=>x+h*f.normal[k]+w*f.width[k]));normals.push(...f.normal);}}
  for(let i=0;i<80;i++){const a=i*2,b=(i+1)%80*2;indices.push(a,b,a+1,a+1,b,b+1);}
  const belt={id:'belt',color:'#ddaa44',positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices)};
  const parts=[belt,...[0,50].map((x,i)=>({id:'p'+i,color:'#888888',positions:new Float32Array([x,0,0,x+2,0,0,x,2,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])}))];
  const model={schema:1,units:'mm-deg',bodies:[{id:'base',fixed:true,origin:[0,0,0],parts:['belt']},...[0,1].map(i=>({id:'b'+i,fixed:false,origin:[i*50,0,0],parts:['p'+i]}))],joints:[0,1].map(i=>({id:'j'+i,type:'revolute',parent:'base',child:'b'+i,origin:[i*50,0,0],axis:[0,0,1]})),relations:[{id:'drive',type:'belt',driver:'j0',follower:'j1',driverTeeth:10,followerTeeth:10,direction:1}],beltSurfaces:[{id:'belt',part:'belt',body:'base',relation:'drive',pitchMm:Math.PI*2,direction:-1,widthAxis:[0,0,1],pulleys}]};
  if(solved){parts.push({...parts[1],id:'world'});model.bodies[0].fixed=false;model.bodies.push({id:'ground',fixed:true,origin:[0,0,0],parts:['world']});model.joints.push({id:'parent',type:'revolute',parent:'ground',child:'base',origin:[0,0,0],axis:[0,0,1]});}
  v.setScene({parts},true);const motion=new MechanismMotion(v).load(model),command=createCanvasCommands({viewer:v,motion,selection});command('motion',{action:'reset'});
  const buffer=v.assemblyVertices,scene=v.scene,before=await v.captureView({view:'top',width:320,height:240});
  command('selection',{ids:['belt']});command('motion',{action:'rotate',part:'j0',degrees:13});
  const moved=v.deformedParts.get('belt').positions.slice(),after=await v.captureView({view:'top',width:320,height:240});
  command('motion',{action:'play',trajectory:{units:'deg-s',tracks:[{target:'j0',segments:[{seconds:.1,acceleration:1000},{seconds:.1,acceleration:-1000}]}]}});await new Promise(r=>setTimeout(r,350));const complete=motion.state().playback.status==='completed';
  command('motion',{action:'reset'});const restored=v.deformedParts.get('belt').positions;
  // Field adapter scales placements only; the same dispatcher keeps mm units.
  const field=createCanvasCommands({viewer:v,motion,selection,unitsPerMm:.001});const c=field('view',{camera:{target:[100,200,300],distance:500}});
  const solvedChecks=[];
  if(solved)for(const unitsPerMm of [1,.001]){
   const api=createCanvasCommands({viewer:v,motion,selection,unitsPerMm,revision:()=> 'belt-test'});
   api('motion',{action:'play-solved',solution:solved});api('motion',{action:'pause'});
   const original=v.deformedParts.get('belt').positions.slice();
   api('motion',{action:'seek',seconds:.5});const halfway=v.deformedParts.get('belt').positions.slice();
   const angle=motion.state().angles.j0,rendered=await v.captureView({view:'top',width:320,height:240});
   // Seek backward then forward: phase must depend on the sample, not history.
   api('motion',{action:'seek',seconds:.13});api('motion',{action:'seek',seconds:.5});
   const deterministic=halfway.every((x,i)=>x===v.deformedParts.get('belt').positions[i]);
   api('motion',{action:'seek',seconds:1});const returned=v.deformedParts.get('belt').positions;
   const reversed=original.every((x,i)=>Math.abs(x-returned[i])<1e-5);
   api('motion',{action:'reset'});const reset=original.every((x,i)=>Math.abs(x-v.deformedParts.get('belt').positions[i])<1e-5);
   solvedChecks.push({angle,deterministic,reversed,reset,changed:halfway.some((x,i)=>Math.abs(x-original[i])>1e-3),png:rendered.image});
  }
  const errors=[];v.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));v.render();await v.device.queue.onSubmittedWorkDone();
  return {solvedChecks,complete,pixelsChanged:before.image!==after.image,geometryChanged:moved.some((x,i)=>x!==restored[i]),sourceUnchanged:positions.every((x,i)=>Math.abs(x-belt.positions[i])<1e-5),sameScene:v.scene===scene,sameBuffer:v.assemblyVertices===buffer,selection:selection.state().selectedIds,fieldCamera:c.camera,errors};
 },solved);
 for(const k of ['complete','pixelsChanged','geometryChanged','sourceUnchanged','sameScene','sameBuffer'])assert.equal(result[k],true,k);assert.deepEqual(result.selection,['belt']);assert.deepEqual(result.errors,[]);assert.equal(result.fieldCamera.distance,500);
 console.log('PASS: existing belt surface deformation, shared commands, selection, capture, reset, fixed GPU buffer and untouched source geometry');
 for(const check of result.solvedChecks){assert.ok(Math.abs(check.angle-900)<1e-6);for(const key of ['deterministic','reversed','reset','changed'])assert.equal(check[key],true,key);}
 if(solved){await Bun.write('build/solved-belt.png',Buffer.from(result.solvedChecks[0].png.split(',')[1],'base64'));console.log('PASS: actual Ondsel nested pulley output drives existing teeth in both canvas scales, full turns, reversal, seek, reset');}
}finally{await browser.close();server.stop(true);}
