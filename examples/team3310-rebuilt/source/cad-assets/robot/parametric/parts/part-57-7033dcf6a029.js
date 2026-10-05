import {getEdges,getBounds,fillet,cylinder,cone,cut,compound,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';

// Upright channel mount paired with Part 58. The recessed face clears the
// neighbouring mechanism; blind base screws leave the upper channel solid.
export const parameters={height:50.8,holeScale:1};
const z0=101.6,cy=-173.4981036;
export default function build({height=parameters.height,holeScale=parameters.holeScale}={}){
 if(!Number.isFinite(height)||height<20||!Number.isFinite(holeScale)||holeScale<=0)throw Error('Height must exceed blind drilling depth and screw scale must be positive');
 const pts=[[-292.1,cy-19.05],[-279.4,cy-19.05],[-279.4,cy-9.525],[-282.575,cy-9.525],[-282.575,cy+9.525],[-279.4,cy+9.525],[-279.4,cy+19.05],[-292.1,cy+19.05]];
 let s=buildPrismaticPart({origin:[0,0,z0],normal:[0,0,1],u:[1,0,0],v:[0,1,0],direction:[0,0,1],depth:height,outline:pts.map((from,i)=>({kind:'line',from,to:pts[(i+1)%pts.length]})),cutouts:[]});
 const upright=getEdges(s).filter(e=>{const q=getBounds(e);return q.zMax-q.zMin>height-.001;});
 s=unwrap(fillet(s,upright,1));
 const top=getEdges(s).filter(e=>{const q=getBounds(e);return Math.abs(q.zMin-z0-height)<1e-5&&Math.abs(q.zMax-z0-height)<1e-5;});
 s=unwrap(fillet(s,top,.5));
 const r=1.7272*holeScale,depth=15.875,tipHeight=r/Math.tan(59*Math.PI/180);
 const cutters=[cylinder(r,9.525+.00002,{at:[-292.10001,cy,111.125],axis:[1,0,0]})];
 for(const y of [cy-9.525,cy+9.525]){
  cutters.push(cylinder(r,depth+.00001,{at:[-285.75,y,z0-.00001],axis:[0,0,1]}));
  cutters.push(cone(r,0,tipHeight,{at:[-285.75,y,z0+depth],axis:[0,0,1]}));
 }
 return unwrap(cut(s,compound(cutters)));
}
