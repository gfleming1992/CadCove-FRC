import * as b from 'brepjs';
import stock from './platform-guard-ring-stock.js';
import holes from './platform-guard-holes.js';
import {buildPrismaticPart} from './profile.js';
export const parameters={baseThickness:6.35,wallHeight:25.4,holeScale:1};
// Separate the guard sector from the shared ribbed ring before rounding.
export default function build({baseThickness=6.35,wallHeight=25.4,holeScale=1,drill=true}={}){
 if(!Number.isFinite(holeScale)||holeScale<=0)throw Error('Positive hole scale required');
 let shape=stock({baseThickness,wallHeight});
 const cx=-162.5586951227978,cy=-173.4981036,cutY=-171.161095874,nx=-Math.sqrt(3)/2,ny=.5,d=nx*cx+ny*cy-.127,x=(d-ny*cutY)/nx,pts=[[x,cutY],[x+500,cutY],[x+250,cutY+Math.sqrt(3)*250]];
 const clip=buildPrismaticPart({origin:[0,0,392],u:[1,0,0],v:[0,1,0],normal:[0,0,1],direction:[0,0,1],depth:baseThickness+wallHeight+5,outline:pts.map((from,i)=>({kind:'line',from,to:pts[(i+1)%pts.length]})),cutouts:[]});
 shape=b.unwrap(b.intersect(shape,clip));
 if(drill)for(const h of holes)shape=b.unwrap(b.cut(shape,b.cylinder(h.radius*holeScale,baseThickness+.002,{at:[...h.center,393.2672]})));
 return shape;
}
