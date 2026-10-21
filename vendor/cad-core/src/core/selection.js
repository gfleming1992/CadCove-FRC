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
 let selected=new Set(),assembly=null,gesture=null;
 const canvas=viewer.canvas;
 const nodes=()=>viewer.draws&&assembly?assembly.instances.map(n=>{const i=viewer.instanceLookup.get(n.id),p=viewer.placements;return {id:n.id,part:assembly.library.get(n.asset),transform:[0,1,2].flatMap(r=>[p[i*20+r],p[i*20+4+r],p[i*20+8+r],p[i*20+12+r]])};}):(viewer.scene?.parts??[]).map(part=>({id:part.id,part}));
 function paint(ids){
  if(viewer.draws&&assembly){for(const id of ids){const i=viewer.instanceLookup.get(id);if(i===undefined)continue;const original=assembly.colors.get(id),color=selected.has(id)?highlight:original;viewer.placements.set([...color,1],i*20+16);viewer.device.queue.writeBuffer(viewer.assemblyInstances,i*80+64,viewer.placements.subarray(i*20+16,i*20+20));}}
  else for(const batch of viewer.batches??[]){if(!batch)continue;let start=0;for(const part of batch.parts){if(ids.has(part.id)){const color=selected.has(part.id)?highlight:[1,3,5].map(i=>parseInt(part.color.slice(i,i+2),16)/255),data=new Float32Array(part.positions.length*3);for(let v=0;v<part.positions.length/3;v++){data.set(part.positions.subarray(v*3,v*3+3),v*9);data.set(part.normals.subarray(v*3,v*3+3),v*9+3);data.set(color,v*9+6);}viewer.device.queue.writeBuffer(batch.vertices,start*36,data);}start+=part.positions.length/3;}}
  viewer.request();
 }
 const state=()=>({selectedIds:[...selected],parts:nodes().filter(n=>selected.has(n.id)).map(n=>({id:n.id,name:n.part.name??n.id}))});
 function set(ids){const valid=new Set(nodes().map(n=>n.id));if(!Array.isArray(ids)||ids.some(id=>!valid.has(id)))throw Error('Unknown selected part');const changed=new Set([...selected,...ids]);selected=new Set(ids);paint(changed);onChange(state());return state();}
 function reconcile(){selected=new Set([...selected].filter(id=>nodes().some(n=>n.id===id)));paint(selected);onChange(state());}
 const setScene=viewer.setScene.bind(viewer);viewer.setScene=(...args)=>{assembly=null;const r=setScene(...args);reconcile();return r;};
 if(viewer.setAssembly){const original=viewer.setAssembly.bind(viewer);viewer.setAssembly=(value,...args)=>{const r=original(value,...args);assembly={...value,library:new Map(value.prototypes.map(p=>[p.id,p])),colors:new Map(value.instances.map(n=>[n.id,[1,3,5].map(i=>parseInt(n.color.slice(i,i+2),16)/255)]))};viewer.selectionOriginalColors=assembly.colors;reconcile();return r;};}
 function pick(x,y){const rect=canvas.getBoundingClientRect(),{x:right,y:up,z:back}=viewer.basis(),c=viewer.camera,t=Math.tan(Math.PI/8),sx=((x-rect.left)/rect.width*2-1)*t*rect.width/rect.height,sy=(1-(y-rect.top)/rect.height*2)*t;return pickPart(nodes(),c.target.map((v,i)=>v+back[i]*c.distance),back.map((v,i)=>-v+right[i]*sx+up[i]*sy));}
 canvas.addEventListener('pointerdown',e=>{if(gesture){gesture=null;return;}if(e.button===0&&e.pointerType!=='touch'&&!e.shiftKey)gesture={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};});
 canvas.addEventListener('pointermove',e=>{if(gesture?.id===e.pointerId&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>4)gesture.moved=true;});
 canvas.addEventListener('pointerup',e=>{const g=gesture;gesture=null;if(!g||g.id!==e.pointerId||g.moved||Math.hypot(e.clientX-g.x,e.clientY-g.y)>4)return;const id=pick(e.clientX,e.clientY),next=e.ctrlKey||e.metaKey?new Set(selected):new Set();if(id){if(next.has(id))next.delete(id);else next.add(id);}set([...next]);});
 for(const event of ['pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{gesture=null;});
 canvas.addEventListener('keydown',e=>{if(e.key==='Escape')set([]);});
 canvas.setAttribute('aria-label','CAD canvas. Click to select; Ctrl or Command-click to toggle selection. Left-drag orbit, right-drag pan, middle-drag red marker. Escape clears selection and markers.');
 return {state,set,pick};
}
