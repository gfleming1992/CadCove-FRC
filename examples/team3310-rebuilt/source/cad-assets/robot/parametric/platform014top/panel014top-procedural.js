import stock from './bracket014top-stock.js';
import pcurveTrims from './panel014top-pcurve-trims.js';
import{getKernel,castShape}from'brepjs';
import trims from './panel014top-trims.js';
import patches from './panel014top-patches.js';
// Split upper platform bracket: inclined stock, curved clearance and seven bores.
// Procedural stock supplies planes and cylinders; three local rolling patches
// preserve the manufactured transitions without unstable automatic fillets.
// Shared contours maintain their tangent junctions independently of OCCT's
// automatic fillet solver. Mounting bores are cut after the guide is assembled.
export const parameters={holeScale:1};
export const bores=[[-26.66516590141,-320.3575,2.286],[-26.66516590141,-304.2689823947,2.286],[15.547409754405,-300.0375,2.5527],[15.547409754405,-309.5625,2.5527],[25.072409754405,-300.0375,2.5527],[20.309909754405,-304.8,2.5527],[25.072409754405,-309.5625,2.5527]];
export default function build({holeScale=parameters.holeScale,drill=true}={}){
 if(!Number.isFinite(holeScale)||holeScale<.8||holeScale>1.2)throw Error('Hole scale must be between0.8 and1.2');
 const k=getKernel(),owned=[],own=h=>(owned.push(h),h),dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 const fitCurve=points=>{const origin=points[0];return own(k.translate(own(k.scale(own(k.interpolatePoints(points.map(p=>p.map((v,i)=>(v-origin[i])*1000)),{tolerance:1e-7})),[0,0,0],.001)),...origin))};
 try{
 const edges=trims.edges.map(e=>{if(e.points&&Math.max(...e.points.map(p=>dist(p,e.points[0])))<1e-9)return null;if(e.type==='line')return own(k.makeLineEdge(...e.points));if(e.type==='circleFull')return own(k.makeCircleEdge(e.center,e.normal,e.radius));if(e.type==='circle')return own(k.makeArcEdge(...e.points));return fitCurve(e.points)});
 const stockOwners=[stock({stage:0})],stockSupports=stockOwners.flatMap(o=>{own(o.wrapped);return k.iterShapes(o.wrapped,'face').map(own)}).map(f=>{const type=k.surfaceType(f),q=k.pointOnSurface(f,0,0);if(type==='plane'){return{f,type,origin:q,normal:k.surfaceNormal(f,0,0)}}if(type==='cylinder'){const r=k.pointOnSurface(f,Math.PI,0),origin=q.map((v,i)=>(v+r[i])/2),axis=k.pointOnSurface(f,0,1).map((v,i)=>v-q[i]);return{f,type,origin,axis,radius:dist(q,origin)}}return{f,type}});const faces=[];
 for(const d of trims.faces){const s=d.support;let support;
 const candidates=stockSupports.filter(p=>p.type===s.type&&((p.type==='plane'&&Math.abs(s.origin.map((v,i)=>v-p.origin[i]).reduce((a,v,i)=>a+v*p.normal[i],0))<1e-5&&Math.abs(s.u.reduce((a,v,i)=>a+v*p.normal[i],0))<1e-7&&Math.abs(s.v.reduce((a,v,i)=>a+v*p.normal[i],0))<1e-7)||(p.type==='cylinder'&&Math.abs(s.radius-p.radius)<1e-5&&Math.abs(Math.abs(s.axis.reduce((a,v,i)=>a+v*p.axis[i],0))-1)<1e-7&&dist(s.origin.map((v,i)=>v-p.origin[i]),s.axis.map(v=>v*s.origin.map((v,i)=>v-p.origin[i]).reduce((a,v,i)=>a+v*s.axis[i],0)))<1e-5)));if(candidates.length){support=candidates[0].f;}else if(s.type==='plane'){const points=[[-500,-500],[500,-500],[500,500],[-500,500]].map(([a,b])=>s.origin.map((v,i)=>v+a*s.u[i]+b*s.v[i]));const wire=own(k.makeWire(points.map((p,i)=>own(k.makeLineEdge(p,points[(i+1)%4])))));support=own(k.makeFace(wire));}
 else if(s.type==='cylinder'){const cylinder=own(k.makeCylinder(s.radius,1000,s.origin.map((v,i)=>v-500*s.axis[i]),s.axis));support=own(k.iterShapes(cylinder,'face').find(f=>k.surfaceType(f)==='cylinder'));const q=k.pointOnSurface(support,0,0),base=s.origin.map((v,i)=>v-500*s.axis[i]),r=q.map((v,i)=>(v-base[i])/s.radius),cross=[r[1]*s.radial[2]-r[2]*s.radial[1],r[2]*s.radial[0]-r[0]*s.radial[2],r[0]*s.radial[1]-r[1]*s.radial[0]],angle=Math.atan2(cross.reduce((a,v,i)=>a+v*s.axis[i],0),r.reduce((a,v,i)=>a+v*s.radial[i],0))*180/Math.PI;support=own(k.rotate(support,angle,s.axis,s.origin));}
 else if(s.type==='torus'){const torus=own(k.makeTorus(s.major,s.minor,s.origin,s.axis));support=own(k.iterShapes(torus,'face')[0]);}
 else if(s.type==='sphere'){const sphere=own(k.makeSphere(s.radius,s.origin));support=own(k.iterShapes(sphere,'face')[0]);}
 else{const patch=patches.find(p=>p.index===d.index);const local=patch.grid.map(p=>p.map((v,i)=>(v-patch.origin[i])*patch.fitScale));support=own(k.translate(own(k.scale(own(k.bsplineSurface(local,patch.n,patch.n)),[0,0,0],1/patch.fitScale)),...patch.origin));}
 const pcurve=pcurveTrims.find(x=>x.face===d.index);const wires=pcurve?[{outer:true,wire:own(k.makeWire(pcurve.edges.map(e=>{const points=e.samples.map(p=>p.slice(2));for(const i of[0,points.length-1]){const near=pcurve.edges.flatMap(x=>[x.samples[0].slice(2),x.samples.at(-1).slice(2)]).filter(x=>dist(x,points[i])<1e-4);points[i]=[0,1,2].map(j=>near.reduce((s,p)=>s+p[j],0)/near.length)}const h=fitCurve(points);return e.reversed?own(k.reverseShape(h)):h;})))}]:d.wires.map(w=>({outer:w.outer,wire:own(k.makeWire(w.edges.filter(e=>edges[e.edge]).map(e=>e.reverse?own(k.reverseShape(edges[e.edge])):edges[e.edge])))})),outer=wires.find(w=>w.outer)?.wire??wires[0].wire,holes=wires.filter(w=>w.wire!==outer).map(w=>w.wire);let best;
 for(const reverse of[false,true])try{let face=own(k.healFace(own(k.makeFaceOnSurface(support,own(k.fixWireOnFace(reverse?own(k.reverseShape(outer)):outer,support,1e-5))))));if(holes.length)face=own(k.healFace(own(k.addHolesInFace(face,holes))));const area=k.area(face),error=Math.abs(area-d.area);if(k.isValid(face)&&area>0&&(!best||error<best.error))best={face,area,error};}catch{}
 if(!best||best.error>.05)throw Error('Invalid trim face '+d.index+' '+JSON.stringify(best&&{area:best.area,error:best.error}));let face=best.face;if(k.shapeOrientation(face)!==d.orientation)face=own(k.reverseShape(face));faces.push(face);
 }
 const shell=own(k.sew(faces,.001));let solid=own(k.solidFromShell(shell));if(k.volume(solid)<0)solid=own(k.reverseShape(solid));
 if(drill)for(const[x,y,r]of bores)solid=own(k.cut(solid,own(k.makeCylinder(r*holeScale,30,[x,y,520],[0,0,1]))));
 if(!k.isValid(solid)||k.volume(solid)<20000||k.iterShapes(solid,'solid').length!==1)throw Error('Guide failed solid validation');return castShape(k.copyShape(solid));
 }finally{for(const h of owned.reverse())k.dispose(h)}
}
