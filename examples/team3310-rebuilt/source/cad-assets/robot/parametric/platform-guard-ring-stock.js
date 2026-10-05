import * as b from 'brepjs';
import profiles from './platform-guard-stock-profiles.js';
import {buildPrismaticPart} from './profile.js';
export const parameters={baseThickness:6.35,wallHeight:25.4};
// Shared platform guard stock: 1/4-inch base, thin curved wall, and reinforcing
// ribs. Kept whole until the original rounding and separation cuts are applied.
export default function build({baseThickness=parameters.baseThickness,wallHeight=parameters.wallHeight,stage=3}={}){
 if(!Number.isFinite(baseThickness)||baseThickness<=0||!Number.isFinite(wallHeight)||wallHeight<=0)throw Error('Positive stock dimensions required');
 const z=393.2682,section=(outline,height,depth)=>buildPrismaticPart({origin:[0,0,height],normal:[0,0,1],u:[1,0,0],v:[0,1,0],direction:[0,0,1],depth,outline,cutouts:[]});
 let shape=section(profiles['Sketch 135'][0],z,baseThickness);if(stage===0)return shape;
 const wall=section(profiles['Sketch 136'][0],z+baseThickness-.00001,wallHeight+.00001);shape=b.unwrap(b.fuse(shape,wall));if(stage===1)return shape;
 const ribs=profiles['Sketch 137'].map(outline=>section(outline,z+baseThickness-.00001,wallHeight+.00001));shape=b.unwrap(b.fuseAll([shape,...ribs]));if(stage===2)return shape;
 // Revolve 3 trims the rib tops to a common conical envelope.
 const center=[-162.5586951227978,-173.4981036],start=z+baseThickness+3.175,height=wallHeight-3.175;
 if(height<=0)throw Error('Wall must exceed the 3.175 mm rib shoulder');
 // The lower cylinder must cover through the cone's start.
 const lower=b.cylinder(181,start-z+1,{at:[...center,z-1]});
 return b.unwrap(b.intersect(shape,b.unwrap(b.fuse(lower,b.cone(180.18125,169.59891182775,height,{at:[...center,start]})))));
}
