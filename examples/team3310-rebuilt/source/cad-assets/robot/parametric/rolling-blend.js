import {getKernel,castShape} from 'brepjs';
// Reconstruct only a local rolling blend. The surrounding stock and mounting
// features remain dimensioned operations; no STEP/BREP is imported at runtime.
export function localBlendTool(data,direction,offset=[0,0,0]) {
  const k=getKernel(),owned=[];
  const own=h=>(owned.push(h),h);
  try {
    const support=own(k.bsplineSurface(data.grid,data.n,data.n));
    const edges=data.curves.map(c=>own(c.type==='line'
      ?k.makeLineEdge(...c.points):k.interpolatePoints(c.points,{periodic:false})));
    const wire=own(k.makeWire(edges));
    let face=own(k.healFace(own(k.makeFaceOnSurface(support,own(k.reverseShape(wire))))));
    if(!k.isValid(face)||k.area(face)<=0)
      face=own(k.healFace(own(k.makeFaceOnSurface(support,wire))));
    if(!k.isValid(face)||k.area(face)<=0)throw Error('Invalid local blend face');
    let tool=own(k.extrude(face,direction,1));
    if(k.volume(tool)<0)tool=own(k.reverseShape(tool));
    if(!k.isValid(tool)||k.volume(tool)<=0)throw Error('Invalid local blend tool');
    return castShape(k.translate(tool,...offset));
  } finally { for(const h of owned.reverse())k.dispose(h); }
}
