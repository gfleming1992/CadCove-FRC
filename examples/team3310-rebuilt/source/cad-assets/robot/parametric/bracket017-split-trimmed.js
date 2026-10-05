import {getKernel,castShape} from 'brepjs';
import buildBody from './bracket017-trimmed-inplace.js';

// Draft: partition the doubly pierced cavity face at its symmetry plane.
// Each face patch has a simpler trimming loop; the split adds no material.
export default function build(options={}) {
 const k=getKernel(),body=buildBody(options),owned=[],own=h=>(owned.push(h),h);
 try {
  const faces=k.iterShapes(body.wrapped,'face');
  const matches=faces.filter(f=>{try{const c=k.getSurfaceCylinderData(f);if(!c||Math.abs(c.radius-2)>1e-6)return false;const box=k.boundingBox(f);return Math.abs(box.min[1]+236.9223073)<.01;}catch{return false;}});
  if(matches.length!==1)throw Error('Expected one doubly pierced cavity face');
  const x=-332.1863409938,points=[[x,-260,380],[x,-200,380],[x,-200,440],[x,-260,440]];
  const wire=own(k.makeWire(points.map((v,i)=>own(k.makeLineEdge(v,points[(i+1)%4])))));
  const plane=own(k.makeFace(wire)),split=own(k.split(matches[0],[plane])),patches=k.iterShapes(split,'face');
  if(patches.length!==4)throw Error('Unexpected cavity partition: '+patches.length);
  const shell=own(k.sew(faces.flatMap(f=>f===matches[0]?patches:[f]),1e-6));
  let solid=own(k.solidFromShell(shell));if(k.volume(solid)<0)solid=own(k.reverseShape(solid));
  if(!k.isValid(solid))throw Error('Invalid cavity partition');
  return castShape(k.copyShape(solid));
 }finally{for(const h of owned.reverse())k.dispose(h);body.delete();}
}
