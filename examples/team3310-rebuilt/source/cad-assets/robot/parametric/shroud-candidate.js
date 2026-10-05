import * as b from 'brepjs';
const Z=46.213031824631,CY=-13.07896185296,R=16.634961852962;
export const parameters={mountHoleRadius:3.429,edgeRadius:5.08};
// Draft reconstruction: original manufacturing planes and bore dimensions.
// Not installed until the complete surface/functional gates pass.
export default function build({mountHoleRadius=3.429,edgeRadius=5.08,round=true,inspect=()=>{}}={}){
 const box=(x0,x1,y0,y1,z0,z1)=>b.box(x1-x0,y1-y0,z1-z0,{at:[(x0+x1)/2,(y0+y1)/2,(z0+z1)/2],centered:true});
 const cut=(s,c)=>b.unwrap(b.cut(s,c));
 const half=(p,n)=>{const len=Math.hypot(...n);n=n.map(v=>v/len);const u=[0,1,0],v=[-n[2],0,n[0]],points=[[-100,-100],[100,-100],[100,100],[-100,100]].map(([a,c])=>p.map((x,i)=>x+a*u[i]+c*v[i]));const w=b.unwrap(b.wireLoop(points.map((q,i)=>b.line(q,points[(i+1)%4]))));return b.unwrap(b.extrude(b.unwrap(b.face(w)),n.map(v=>v*200)))};
 let shape=b.unwrap(b.simplify(b.unwrap(b.fuseAll([
  b.cylinder(R,Z-5.08,{at:[0,CY,5.08]}),
  box(0,R,CY,3.556,5.08,Z),box(-40,0,-24.13,-2.413,5.08,Z),box(6.858,36.83,2.032,24.13,5.08,Z)
 ]))));
 shape=cut(shape,half([-36.89755113412104,-13.271500000000003,16.971532424405996],[-0.9999921491032121,3.8177969987988086e-33,-0.00396254109621884]));
 shape=cut(shape,half([28.47531652748442,11.5608838189339,39.38798524895858],[0.7071067811865476,-6.812775139722641e-31,0.7071067811865476]));
 shape=cut(shape,half([-33.88085246565831,-12.170456622344403,34.05753042622286],[-0.7085063659190968,-6.799263790887928e-31,0.7057044207400964]));
 inspect('sharp',shape);
 if(round){
  shape=b.getSolids(shape)[0];
  const left=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.xMin< -30&&(q.zMax-q.zMin>1||q.xMax< -36&&q.zMin>30&&q.zMax<32)});
  shape=b.unwrap(b.fillet(shape,left,edgeRadius));
  const inside=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.zMax-q.zMin>1&&q.yMax-q.yMin<1e-6&&q.xMax-q.xMin<1e-6&&Math.abs(q.xMin)<20&&!(Math.abs(q.xMin-R)<1e-6&&Math.abs(q.yMin-CY)<1e-6||Math.abs(q.xMin)<1e-6&&Math.abs(q.yMin-3.556)<1e-6)});
  shape=b.unwrap(b.fillet(shape,inside,edgeRadius));inspect("rounded",shape);
  const outer=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.xMax>30&&(q.zMax-q.zMin>1||Math.abs(q.xMin)>36&&q.zMin>30&&q.zMax<32)});
  shape=b.unwrap(b.fillet(shape,outer,edgeRadius));inspect("outer-rounded",shape);

 }
 // Clearance under the central duct; the two mounting sides intentionally differ.
 shape=cut(shape,box(-19.9136,0,-24.13,50,0,28.941031824631));
 shape=cut(shape,box(0,19.939,-24.13,50,0,24.623031824631));
 const poly=[[-6.956625694969,0],[-6.956625694969,29.708903306169],[-4.08187334908,34.021031824631],[4.08187334908,34.021031824631],[6.858,29.856841848614],[6.858,0]];
 const wire=b.unwrap(b.wireLoop(poly.map((p,i)=>b.line([p[0],CY,p[1]],[poly[(i+1)%poly.length][0],CY,poly[(i+1)%poly.length][1]]))));
 shape=cut(shape,b.unwrap(b.extrude(b.unwrap(b.face(wire)),[0,60,0])));
 shape=cut(shape,box(-60,60,-50,-24.13,0,17.003031824631));
 shape=cut(shape,b.unwrap(b.cut(box(-40,0,-50,-24.13,5.08,28.941031824631),b.cylinder(R,60,{at:[0,CY,0]}))));
 // Rounded underside joins the lower left shelf to the central clearance.
 if(round){
 const relief=b.cylinder(5.08,40,{at:[-40,2.667,28.941031824631],axis:[1,0,0]});
 shape=cut(shape,b.unwrap(b.intersect(relief,box(-40,0,-2.413,2.667,28.941031824631,34.021031824631))));
 shape=cut(shape,box(-40,0,2.667,50,0,34.021031824631));
 shape=b.getSolids(shape)[0];
 const toes=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.zMax-q.zMin<1e-6&&Math.abs(q.zMin-5.08)<1e-6&&q.xMax-q.xMin<1e-6&&(Math.abs(q.xMin-19.939)<1e-6||Math.abs(q.xMin+19.9136)<1e-6)});
 shape=b.unwrap(b.fillet(shape,toes,3.048));
 const back=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.zMax-q.zMin>1&&q.xMax-q.xMin<1e-6&&q.yMax-q.yMin<1e-6&&Math.abs(q.yMin+24.13)<1e-6&&Math.abs(Math.abs(q.xMin)-12.43368455938)<1e-5});
 shape=b.unwrap(b.fillet(shape,back,.396875));
 }
 inspect("clearance",shape);
 for(const[x,y]of[[-28.575,-13.97],[28.575,13.97]]){
  shape=cut(shape,b.cylinder(mountHoleRadius,3.17502,{at:[x,y,5.07999]}));
  const radius=5.75625/Math.cos(Math.PI/6),pts=Array.from({length:6},(_,i)=>[x+radius*Math.cos(Math.PI/6+i*Math.PI/3),y+radius*Math.sin(Math.PI/6+i*Math.PI/3),8.255]);
  const w=b.unwrap(b.wireLoop(pts.map((p,i)=>b.line(p,pts[(i+1)%6]))));shape=cut(shape,b.unwrap(b.extrude(b.unwrap(b.face(w)),[0,0,50])));
 }
 shape=cut(shape,b.cylinder(11.191875,50,{at:[0,CY,0]}));inspect("bores",shape);
 if(round){
 shape=b.getSolids(shape)[0];
 const bore=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.zMax-q.zMin<1e-6&&Math.abs(q.zMin-Z)<1e-6&&b.getCurveType(e)==="CIRCLE"&&Math.abs(q.xMax-11.191875)<1e-5});
 shape=b.unwrap(b.chamfer(shape,bore,2.143125));inspect("countersunk",shape);
 const top=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.zMax-q.zMin<1e-6&&Math.abs(q.zMin-Z)<1e-6});
 shape=b.unwrap(b.chamfer(shape,top,.5));inspect("beveled",shape);
 }
 return shape;
}
