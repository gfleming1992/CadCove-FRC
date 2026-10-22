// Display-only picking and selection. Source meshes, colors and caches stay immutable.
const identity=[1,0,0,0,0,1,0,0,0,0,1,0],highlight=[1,.83,.25];
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const bounds=new WeakMap();
function box(part){if(bounds.has(part.positions))return bounds.get(part.positions);const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];part.positions.forEach((x,i)=>{lo[i%3]=Math.min(lo[i%3],x);hi[i%3]=Math.max(hi[i%3],x)});const b={lo,hi};bounds.set(part.positions,b);return b;}
export function pickPart(nodes,origin,direction){
 let best=Infinity,hit=null;
 for(const {id,part,transform:m=identity} of nodes){
  const scale=m[0]**2+m[4]**2+m[8]**2,offset=sub(origin,[m[3],m[7],m[11]]);
  const local=v=>[0,1,2].map(k=>(m[k]*v[0]+m[k+4]*v[1]+m[k+8]*v[2])/scale),o=local(offset),d=local(direction),b=box(part);
  let near=0,far=best;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-14){if(o[k]<b.lo[k]||o[k]>b.hi[k])far=-1;}else{let a=(b.lo[k]-o[k])/d[k],z=(b.hi[k]-o[k])/d[k];near=Math.max(near,Math.min(a,z));far=Math.min(far,Math.max(a,z));}}
  if(far<near)continue;
  const p=part.positions,ix=part.indices,vertex=i=>[p[i*3],p[i*3+1],p[i*3+2]];
  for(let i=0;i<ix.length;i+=3){const a=vertex(ix[i]),e1=sub(vertex(ix[i+1]),a),e2=sub(vertex(ix[i+2]),a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)continue;const s=sub(o,a),u=dot(s,h)/det;if(u<0||u>1)continue;const q=cross(s,e1),v=dot(d,q)/det;if(v<0||u+v>1)continue;const t=dot(e2,q)/det;if(t>=0&&t<best){best=t;hit=id;}}
 }
 return hit;
}
export function installSelection(viewer,onChange=()=>{}){
 let selected=new Set(),highlights=new Map(),assembly=null,gesture=null,hidden=new Set(),reveal=null,revealTimer=null;
 const canvas=viewer.canvas;
 const nodes=()=>viewer.draws&&assembly?assembly.instances.map(n=>{const i=viewer.instanceLookup.get(n.id),p=viewer.placements;return {id:n.id,name:n.name,part:viewer.deformedParts?.get(n.asset)??assembly.library.get(n.asset),transform:[0,1,2].flatMap(r=>[p[i*20+r],p[i*20+4+r],p[i*20+8+r],p[i*20+12+r]])};}):(viewer.scene?.parts??[]).map(part=>({id:part.id,part}));
 function paint(ids){
  if(viewer.draws&&assembly){for(const id of ids){const i=viewer.instanceLookup.get(id);if(i===undefined)continue;const original=assembly.colors.get(id),color=selected.has(id)?highlight:highlights.get(id)?.rgb??original;viewer.placements.set(color,i*20+16);viewer.device.queue.writeBuffer(viewer.assemblyInstances,i*80+64,viewer.placements.subarray(i*20+16,i*20+19));}}
  else for(const batch of viewer.batches??[]){if(!batch)continue;let start=0;for(const part of batch.parts){if(ids.has(part.id)){const color=selected.has(part.id)?highlight:highlights.get(part.id)?.rgb??[1,3,5].map(i=>parseInt(part.color.slice(i,i+2),16)/255),data=new Float32Array(part.positions.length*3);for(let v=0;v<part.positions.length/3;v++){data.set(part.positions.subarray(v*3,v*3+3),v*9);data.set(part.normals.subarray(v*3,v*3+3),v*9+3);data.set(color,v*9+6);}viewer.device.queue.writeBuffer(batch.vertices,start*36,data);}start+=part.positions.length/3;}}
  viewer.request();
 }
 const opacityState=()=>({parts:[...(viewer.instanceLookup??[])].filter(([id,i])=>viewer.placements[i*20+19]!==1).map(([id,i])=>({id,opacity:viewer.placements[i*20+19]}))});
 const state=()=>({opacity:opacityState(),hiddenIds:[...hidden],reveal:reveal?{running:true,isolated:reveal.isolated,ids:[...reveal.ids],cycles:reveal.cycles,intervalMs:reveal.intervalMs}:{running:false,isolated:false},selectedIds:[...selected],highlights:[...highlights].map(([id,value])=>({id,color:value.color})),parts:nodes().filter(n=>selected.has(n.id)).map(n=>({id:n.id,name:n.name??n.part.name??n.id}))});
 function set(ids){const valid=new Set(nodes().map(n=>n.id));if(!Array.isArray(ids)||ids.some(id=>!valid.has(id)))throw Error('Unknown selected part');const changed=new Set([...selected,...ids]);selected=new Set(ids);paint(changed);onChange(state());return state();}
 function setHighlights(items){
  const valid=new Set(nodes().map(n=>n.id)),next=new Map();
  if(!Array.isArray(items)||items.length>200)throw Error('Use at most 200 highlighted parts');
  for(const item of items){const color=item?.color??'#24c8e5';if(!valid.has(item?.id)||next.has(item.id)||!/^#[a-f0-9]{6}$/i.test(color))throw Error('Invalid highlighted part or color');next.set(item.id,{color,rgb:[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)});}
  const changed=new Set([...highlights.keys(),...next.keys()]);stopReveal();highlights=next;paint(changed);onChange(state());return state();
 }
 function reconcile(){const valid=new Set(nodes().map(n=>n.id));if(reveal&&[...reveal.ids].some(id=>!valid.has(id)))stopReveal();selected=new Set([...selected].filter(id=>valid.has(id)));hidden=new Set([...hidden].filter(id=>valid.has(id)));highlights=new Map([...highlights].filter(([id])=>valid.has(id)));paint(new Set([...selected,...highlights.keys()]));onChange(state());}
 const setScene=viewer.setScene.bind(viewer);viewer.setScene=(...args)=>{stopReveal();assembly=null;highlights.clear();hidden.clear();const r=setScene(...args);reconcile();return r;};
 if(viewer.setAssembly){const original=viewer.setAssembly.bind(viewer);viewer.setAssembly=(value,...args)=>{const r=original(value,...args);assembly={...value,library:new Map(value.prototypes.map(p=>[p.id,p])),colors:new Map(value.instances.map(n=>[n.id,[1,3,5].map(i=>parseInt(n.color.slice(i,i+2),16)/255)]))};viewer.selectionOriginalColors=assembly.colors;reconcile();return r;};}
 function stopReveal(){if(revealTimer!==null)clearInterval(revealTimer);revealTimer=null;reveal=null;viewer.request();return state();}
 function startReveal({ids=[...highlights.keys()],cycles=2,intervalMs=1250}={}){
  const valid=new Set(nodes().map(n=>n.id));
  if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>!valid.has(id)))throw Error('Reveal requires 1–200 existing unique part IDs');
  if(!Number.isInteger(cycles)||cycles<1||cycles>10||!Number.isInteger(intervalMs)||intervalMs<500||intervalMs>5000)throw Error('Use 1–10 cycles and 500–5000 ms per phase');
  stopReveal();reveal={ids:new Set(ids),cycles,intervalMs,isolated:true,start:performance.now()};
  revealTimer=setInterval(()=>{const phase=Math.floor((performance.now()-reveal.start)/intervalMs);if(phase>=cycles*2){stopReveal();onChange(state());return;}const isolated=phase%2===0;if(reveal.isolated!==isolated){reveal.isolated=isolated;viewer.request();onChange(state());}},Math.min(100,intervalMs));
  viewer.request();onChange(state());return state();
 }
 function visibility({action='state',ids,names}={}){
  if(!['state','hide','show','isolate','show-all'].includes(action))throw Error('Unknown visibility action');
  if(action==='state')return state();
  const all=nodes(),valid=new Set(all.map(n=>n.id));let targets=new Set();
  if(action!=='show-all'){
   if(ids!==undefined){if(!Array.isArray(ids)||!ids.length||ids.some(id=>!valid.has(id)))throw Error('Expected existing nonempty part IDs');ids.forEach(id=>targets.add(id));}
   if(names!==undefined){
    if(!Array.isArray(names)||!names.length||names.some(name=>typeof name!=='string'||!name.trim()))throw Error('Expected nonempty part names');
    for(const name of names){const matches=all.filter(n=>(n.name??n.part.name??n.id).toLowerCase()===name.toLowerCase());if(!matches.length)throw Error('No part named: '+name);matches.forEach(n=>targets.add(n.id));}
   }
   if(ids===undefined&&names===undefined)targets=new Set(selected);
   if(!targets.size)throw Error('Select parts or provide existing IDs or exact names');
  }
  stopReveal();
  if(action==='show-all')hidden.clear();
  else if(action==='isolate')hidden=new Set(all.filter(n=>!targets.has(n.id)).map(n=>n.id));
  else for(const id of targets){if(action==='hide')hidden.add(id);else hidden.delete(id);}
  viewer.request();onChange(state());return state();
 }
 function opacity({action='state',ids,names,scope='only',value}={}){
  if(!['state','set','reset'].includes(action)||!['only','except','all'].includes(scope))throw Error('Opacity action must be state/set/reset and scope only/except/all');
  if(action==='state')return opacityState();
  if(action==='set'&&(!Number.isFinite(value)||value<0||value>1))throw Error('Opacity value must be between 0 (invisible) and 1 (opaque)');
  const all=nodes(),valid=new Set(all.map(n=>n.id)),targets=new Set();
  if(scope==='all'&&(ids!==undefined||names!==undefined))throw Error('All scope cannot also specify part targets');
  if(ids!==undefined){if(!Array.isArray(ids)||!ids.length||ids.some(id=>!valid.has(id)))throw Error('Expected existing nonempty part IDs');ids.forEach(id=>targets.add(id));}
  if(names!==undefined){if(!Array.isArray(names)||!names.length||names.some(n=>typeof n!=='string'||!n.trim()))throw Error('Expected nonempty part names');for(const name of names){const matches=all.filter(n=>(n.name??n.part.name??n.id).toLowerCase()===name.toLowerCase());if(!matches.length)throw Error('No part named: '+name);matches.forEach(n=>targets.add(n.id));}}
  if(scope!=='all'&&ids===undefined&&names===undefined)selected.forEach(id=>targets.add(id));
  if(scope!=='all'&&!targets.size)throw Error('Select parts or provide existing IDs or exact names');
  const changes=Object.fromEntries(all.filter(n=>scope==='all'||(scope==='except'?!targets.has(n.id):targets.has(n.id))).map(n=>[n.id,action==='reset'?(viewer.materialOpacity?.get(n.id)??1):value]));
  if(!viewer.draws){if(!viewer.setAssembly||!viewer.scene)throw Error('Opacity requires the assembly renderer');viewer.setAssembly({prototypes:viewer.scene.parts,instances:viewer.scene.parts.map(p=>({id:p.id,asset:p.id,color:p.color,transform:identity}))},false);}
  viewer.setOpacity(changes);onChange(state());return opacityState();
 }
 const visible=id=>reveal?.isolated?reveal.ids.has(id):!hidden.has(id);
 const originalDraw=viewer.draw.bind(viewer);viewer.draw=pass=>{
  if(!reveal?.isolated&&!hidden.size)return originalDraw(pass);
  if(viewer.draws){
   const indices=[...viewer.instanceLookup.keys()].filter(visible).map(id=>viewer.instanceLookup.get(id));
   viewer.drawAssembly(pass,{indices});
  }else{
   pass.setPipeline(viewer.pipeline);pass.setBindGroup(0,viewer.group);
   for(const batch of viewer.batches??[]){if(!batch)continue;pass.setPipeline(viewer.pipeline);pass.setVertexBuffer(0,batch.vertices);pass.setIndexBuffer(batch.indices,'uint32');let first=0;for(const p of batch.parts){if(visible(p.id))pass.drawIndexed(p.indices.length,1,first);first+=p.indices.length;}viewer.drawBatchEdges?.(pass,batch,visible);}
  }
 };
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stopReveal();});
 window.addEventListener('beforeunload',stopReveal);
 function view(options={}){
  if(!options||Array.isArray(options)||Object.keys(options).some(k=>!['camera','view','fit','ids','pan','zoom'].includes(k)))throw Error('Unknown CAD view option');
  const poses={iso:[1,1],front:[-Math.PI/2,Math.PI/2],back:[Math.PI/2,Math.PI/2],right:[0,Math.PI/2],left:[Math.PI,Math.PI/2],top:[-Math.PI/2,.001],bottom:[-Math.PI/2,Math.PI-.001]};
  let camera={...viewer.camera,target:[...viewer.camera.target]};
  if(options.view!==undefined){if(!Object.hasOwn(poses,options.view))throw Error('Unknown CAD view');[camera.yaw,camera.pitch]=poses[options.view];}
  if(options.fit!==undefined&&typeof options.fit!=='boolean')throw Error('fit must be boolean');
  if(options.fit===true||options.ids!==undefined){
   const all=nodes(),ids=options.ids??all.map(n=>n.id);
   if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!all.some(n=>n.id===id)))throw Error('Expected existing unique nonempty view IDs');
   const selected=new Set(ids),low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
   for(const n of all){if(!selected.has(n.id))continue;const b=box(n.part),m=n.transform??identity;for(let c=0;c<8;c++){const p=[0,1,2].map(k=>(c>>k)&1?b.hi[k]:b.lo[k]);for(let r=0;r<3;r++){const v=m[r*4+3]+p.reduce((s,x,k)=>s+x*m[r*4+k],0);low[r]=Math.min(low[r],v);high[r]=Math.max(high[r],v);}}}
   const radius=Math.max(.001,Math.hypot(...high.map((v,i)=>v-low[i]))/2),aspect=Math.max(.001,canvas.clientWidth/Math.max(1,canvas.clientHeight));
   camera.target=low.map((v,i)=>(v+high[i])/2);camera.distance=radius/Math.sin(Math.atan(Math.tan(Math.PI/8)*Math.min(1,aspect)))*1.1;
  }
  if(options.camera!==undefined){const c=options.camera;if(!c||Array.isArray(c)||Object.keys(c).some(k=>!['target','distance','yaw','pitch'].includes(k)))throw Error('Invalid camera fields');camera={...camera,...c};}
  if(options.pan!==undefined){if(!Array.isArray(options.pan)||options.pan.length!==3||!options.pan.every(Number.isFinite))throw Error('Pan must be [x,y,z] millimetres');if(!Array.isArray(camera.target)||camera.target.length!==3)throw Error('Invalid camera target');camera.target=camera.target.map((v,i)=>v+options.pan[i]);}
  if(options.zoom!==undefined){if(!Number.isFinite(options.zoom)||options.zoom<=0)throw Error('Zoom must be a positive distance multiplier');camera.distance*=options.zoom;}
  if(!Array.isArray(camera.target)||camera.target.length!==3||![...camera.target,camera.distance,camera.yaw,camera.pitch].every(Number.isFinite)||camera.distance<=0||camera.pitch<=0||camera.pitch>=Math.PI)throw Error('Invalid CAD camera; use mm and radians, distance > 0, 0 < pitch < pi');
  viewer.camera={...camera,target:[...camera.target]};viewer.request();return {camera:structuredClone(viewer.camera)};
 }
 function pick(x,y){const rect=canvas.getBoundingClientRect(),{x:right,y:up,z:back}=viewer.basis(),c=viewer.camera,t=Math.tan(Math.PI/8),sx=((x-rect.left)/rect.width*2-1)*t*rect.width/rect.height,sy=(1-(y-rect.top)/rect.height*2)*t;return pickPart(nodes().filter(n=>visible(n.id)),c.target.map((v,i)=>v+back[i]*c.distance),back.map((v,i)=>-v+right[i]*sx+up[i]*sy));}
 canvas.addEventListener('pointerdown',e=>{if(gesture){gesture=null;return;}if(e.button===0&&e.pointerType!=='touch'&&!e.shiftKey)gesture={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};});
 canvas.addEventListener('pointermove',e=>{if(gesture?.id===e.pointerId&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>4)gesture.moved=true;});
 canvas.addEventListener('pointerup',e=>{const g=gesture;gesture=null;if(!g||g.id!==e.pointerId||g.moved||Math.hypot(e.clientX-g.x,e.clientY-g.y)>4)return;const id=pick(e.clientX,e.clientY),next=e.ctrlKey||e.metaKey?new Set(selected):new Set();if(id){if(next.has(id))next.delete(id);else next.add(id);}set([...next]);});
 for(const event of ['pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{gesture=null;});
 canvas.addEventListener('keydown',e=>{if(e.key==='Escape'){visibility({action:'show-all'});opacity({action:'reset',scope:'all'});setHighlights([]);set([]);}});
 canvas.setAttribute('aria-label','CAD canvas. Click to select; Ctrl or Command-click to toggle selection. Left-drag orbit, right-drag pan, middle-drag red marker. Escape shows all parts and clears selection, agent highlights and markers.');
 return {state,set,setHighlights,pick,view,opacity,visibility,startReveal,stopReveal};
}
