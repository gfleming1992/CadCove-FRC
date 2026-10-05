import {getKernel,castShape} from 'brepjs';
import buildStock from './bracket017-stock-parametric.js';
import data from './bracket017-lip-surface-data.js';
// Draft: replace only the lip-end blend; mounting bores retain procedural edits.
export default function build(options={}) {
 options={sewTolerance:.000001,useStockWire:true,skipHealing:true,...options};
 const k=getKernel(),stock=buildStock(options),faces=k.iterShapes(stock.wrapped,'face'),owned=[],own=h=>(owned.push(h),h),origin=data.origin;
 try{
  const big=own(k.bsplineSurface(data.grid.map(p=>p.map((v,i)=>(v-origin[i])*1000)),data.n,data.n));
  const support=own(k.translate(own(k.scale(big,[0,0,0],.001)),...origin));
  const edges=data.curves.map(c=>{let e;if(c.type==='line')e=own(k.makeLineEdge(...c.points));else{const points=c.points.map(p=>p.map((v,i)=>(v-origin[i])*1000));e=own(k.translate(own(k.scale(own(k.interpolatePoints(points,{periodic:false,tolerance:1e-7})),[0,0,0],.001)),...origin));}return c.reverse?own(k.reverseShape(e)):e;});
  const sourceFace=faces.find(f=>{if(Math.abs(k.area(f)-data.area)>.1)return false;const box=k.boundingBox(f);return Math.abs(box.min[0]+315.4552697)<.05&&Math.abs(box.min[1]+217.8380619)<.05;});
  const wire=options.useStockWire?own(k.outerWire(sourceFace)):own(k.makeWire(edges));let face;
  for(const w of [wire,own(k.reverseShape(wire))]){try{const f=own(k.healFace(own(k.makeFaceOnSurface(support,w))));if(k.isValid(f)&&Math.abs(k.area(f)-data.area)<.01){face=f;break;}}catch{}}
  if(!face)throw Error('Could not build lip face');
  if(k.shapeOrientation(face)!==data.orientation)face=own(k.reverseShape(face));
  if(options.flipLip)face=own(k.reverseShape(face));
  const matches=faces.filter(f=>{if(Math.abs(k.area(f)-data.area)>.1)return false;const box=k.boundingBox(f);return Math.abs(box.min[0]+315.4552697)<.05&&Math.abs(box.min[1]+217.8380619)<.05&&Math.abs(box.max[2]-404.6982)<.05;});
  if(matches.length!==1)throw Error('Ambiguous lip face: '+matches.length);
  const remaining=faces.filter(f=>f!==matches[0]),shell=own(k.sew([...remaining,face],options.sewTolerance??.001));let solid=own(k.solidFromShell(shell));if(k.volume(solid)<0)solid=own(k.reverseShape(solid));
  if(!options.skipHealing)solid=own(k.healSolid(solid));options.inspect?.(solid);if(!k.isValid(solid)||k.volume(solid)<28000)throw Error('Invalid replaced lip '+JSON.stringify({valid:k.isValid(solid),volume:k.volume(solid),faceArea:k.area(face),oldFaceArea:k.area(matches[0])}));
  return castShape(k.copyShape(solid));
 }finally{owned.reverse().forEach(h=>k.dispose(h));}
}
