import {box,cylinder} from 'brepjs';
import {robotParts,fieldParts} from './design.js';
export function buildParts(parts){
 return parts.map(part=>{
  const p=part.position.map(x=>x*1000);
  const shape=part.kind==='wheel'
   ?cylinder(part.radius*1000,part.width*1000,{at:[p[0],p[1]-part.width*500,p[2]],axis:[0,1,0]})
   :box(...part.size.map(v=>v*1000),{at:p,centered:true});
  return {id:part.id,name:part.id,color:part.color,shape};
 });
}
export const field=()=>buildParts(fieldParts);
export default ()=>buildParts(robotParts);
