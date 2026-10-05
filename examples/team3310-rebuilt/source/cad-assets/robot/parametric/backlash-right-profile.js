import * as b from 'brepjs';
// Build matching webs and plates on identical analytic circle supports.
export function canonicalizeProfiles(profiles){
 const circles=[];
 for(const p of profiles)for(const e of p.outline)if(e.kind==='arc'){
  const [a,c,d]=[e.from,e.mid,e.to],cross=(u,v)=>u[0]*v[1]-u[1]*v[0],u=c.map((v,i)=>v-a[i]),v=d.map((v,i)=>v-a[i]),den=2*cross(u,v),us=u[0]**2+u[1]**2,vs=v[0]**2+v[1]**2;
  let center=[a[0]+(us*v[1]-vs*u[1])/den,a[1]+(u[0]*vs-v[0]*us)/den],radius=Math.hypot(a[0]-center[0],a[1]-center[1]);
  const match=circles.find(q=>Math.hypot(q.center[0]-center[0],q.center[1]-center[1])<1e-5&&Math.abs(q.radius-radius)<1e-5);
  if(match)({center,radius}=match);else circles.push({center,radius});Object.assign(e,{center,radius});
 }
}
export function buildProfile(p){
 const k=b.getKernel(),point=([u,v])=>p.origin.map((n,i)=>n+u*p.u[i]+v*p.v[i]);
 const edges=p.outline.map(e=>{
  if(e.kind==='line')return b.line(point(e.from),point(e.to));
  if(e.kind!=='arc')throw Error('Expected line or arc');
  const center=point(e.center),circle=k.makeCircleEdge(center,p.normal,e.radius),origin=k.curvePointAtParam(circle,0),quarter=k.curvePointAtParam(circle,Math.PI/2),ux=origin.map((v,i)=>(v-center[i])/e.radius),uy=quarter.map((v,i)=>(v-center[i])/e.radius),angle=q=>{const d=point(q).map((v,i)=>v-center[i]);return Math.atan2(d.reduce((s,v,i)=>s+v*uy[i],0),d.reduce((s,v,i)=>s+v*ux[i],0));},tau=2*Math.PI,wrap=a=>(a%tau+tau)%tau;
  let start=angle(e.from),end=angle(e.to),mid=angle(e.mid),reverse=wrap(mid-start)>wrap(end-start);if(reverse)[start,end]=[end,start];end=start+wrap(end-start);const arc=b.castShape(k.makeCircleArc(center,p.normal,e.radius,start,end));k.dispose(circle);return reverse?b.flipOrientation(arc):arc;
 });
 return b.unwrap(b.extrude(b.unwrap(b.face(b.unwrap(b.wireLoop(edges)))),p.direction.map(v=>v*p.depth)));
}
