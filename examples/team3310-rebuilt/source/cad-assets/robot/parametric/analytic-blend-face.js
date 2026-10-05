import {getKernel,castShape} from 'brepjs';
// Keep analytic trim arcs exact. An interpolated trim can be close visually but
// still cause invalid intersections at the adjoining rolling fillets.
export function analyticBlendFace(data) {
 const k=getKernel(),owned=[],own=h=>(owned.push(h),h);
 try {
  const large=own(k.bsplineSurface(data.grid.map(p=>p.map((v,i)=>(v-data.fitOrigin[i])*data.fitScale)),data.n,data.n));
  const support=own(k.translate(own(k.scale(large,[0,0,0],1/data.fitScale)),...data.fitOrigin));
  const edges=data.curves.map(c=>c.type==='circle'?own(k.makeArcEdge(...c.points)):own(k.transform(own(k.makeEllipseArc([0,0,0],[0,0,1],c.major,c.minor,c.first,c.last)),c.matrix)));
  const wire=own(k.makeWire(edges));
  let face=own(k.healFace(own(k.makeFaceOnSurface(support,own(k.reverseShape(wire))))));
  if(!k.isValid(face)||k.area(face)<=0)face=own(k.healFace(own(k.makeFaceOnSurface(support,wire))));
  if(!k.isValid(face)||k.area(face)<=0)throw Error('Invalid analytic blend face');
  return castShape(k.copyShape(face));
 }finally{for(const h of owned.reverse())k.dispose(h);}
}
