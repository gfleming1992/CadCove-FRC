import {getKernel,castShape} from 'brepjs';
import {buildRoundedStock as stock,finishMount,parameters} from './mount2025-stock.js';
import {analyticBlendFace} from './analytic-blend-face.js';
import patches from './mount2025-blends.js';
import trims from './mount2025-trims.js';
export {parameters};
// Preserve the stock's window and drilling features while sharing exact trim
// boundaries between the corner patches and their three adjacent faces.
export default function build(options={}){
 const k=getKernel(),base=stock(options),faces=k.iterShapes(base.wrapped,'face'),owners=patches.map(p=>analyticBlendFace(p)),replaced=new Map();
 for(const data of trims){
  const near=faces.filter(f=>k.surfaceType(f)===data.type).map(f=>({f,d:Math.hypot(...k.surfaceCenterOfMass(f).map((v,i)=>v-data.center[i]))})).sort((a,b)=>a.d-b.d)[0];if(!near||near.d>2)throw Error('Missing adjacent '+data.type);
  const f=near.f,edges=data.curves.map(c=>c.type==='line'?k.makeLineEdge(...c.points):c.type==='circle'?k.makeArcEdge(...c.points):k.transform(k.makeEllipseArc([0,0,0],[0,0,1],c.major,c.minor,c.first,c.last),c.matrix)),wire=k.makeWire(edges);
  let fresh=k.healFace(k.makeFaceOnSurface(f,wire));if(k.area(fresh)<=0)fresh=k.healFace(k.makeFaceOnSurface(f,k.reverseShape(wire)));
  const wires=k.iterShapes(f,'wire').sort((a,b)=>k.length(b)-k.length(a));if(wires.length>1){for(const hole of wires.slice(1)){let cutter=k.healFace(k.makeFaceOnSurface(f,hole));if(k.area(cutter)<=0)cutter=k.healFace(k.makeFaceOnSurface(f,k.reverseShape(hole)));if(!k.isValid(cutter))throw Error('Invalid hole cutter');fresh=k.cut(fresh,cutter);}const fs=k.iterShapes(fresh,'face');if(fs.length!==1)throw Error('Expected one trimmed plane, got '+fs.length);fresh=fs[0];}
  if(k.shapeOrientation(fresh)!==k.shapeOrientation(f))fresh=k.reverseShape(fresh);
  if(!k.isValid(fresh)||k.area(fresh)<=0)throw Error('Invalid adjacent '+data.index);replaced.set(f,fresh);
 }
 const joined=faces.filter(f=>k.surfaceType(f)!=='bspline').map(f=>replaced.get(f)??f).concat(owners.map(o=>o.wrapped)),shell=k.sew(joined,.00001);let solid=k.solidFromShell(shell);if(k.volume(solid)<0)solid=k.reverseShape(solid);
 if(!k.isValid(solid))throw Error('Invalid neighborhood solid');return finishMount(castShape(solid),options);
}
