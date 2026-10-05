import {getEdges,getBounds,fillet,cut,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';

// Drive-base tie spacer. Hex bores preserve the two mounting interfaces;
// the shallow center relief clears the neighbouring structure. Build its
// S-shaped transition explicitly because opposing tangent rounds consume the
// entire relief depth; a generic simultaneous fillet is numerically unstable.
export const parameters={nutAcrossFlats:9.5758,notchWidth:25.4};
export const stockProfile={"origin":[0,0,73.025],"normal":[0,0,1],"u":[1,0,0],"v":[0,1,0],"direction":[0,0,1],"depth":25.4,"outline":[{"kind":"line","from":[-166.5271299333,-95.25],"to":[-220.8228700666,-95.25]},{"kind":"arc","from":[-221.9338886285,-94.7964285714],"mid":[-221.4228886675,-95.1322394084],"to":[-220.8228700666,-95.25]},{"kind":"arc","from":[-221.9338886285,-94.7964285715],"mid":[-238.125,-101.6],"to":[-221.9338886285,-108.4035714285]},{"kind":"arc","from":[-220.8228700666,-107.95],"mid":[-221.4228886675,-108.0677605916],"to":[-221.9338886285,-108.4035714286]},{"kind":"line","from":[-220.8228700666,-107.95],"to":[-166.5271299333,-107.95]},{"kind":"arc","from":[-165.4161113714,-108.4035714286],"mid":[-165.9271113324,-108.0677605916],"to":[-166.5271299333,-107.95]},{"kind":"arc","from":[-165.4161113715,-108.4035714285],"mid":[-149.225,-101.6],"to":[-165.4161113714,-94.7964285714]},{"kind":"arc","from":[-166.5271299333,-95.25],"mid":[-165.9271113324,-95.1322394084],"to":[-165.4161113714,-94.7964285714]}],"cutouts":[]};
export default function build({nutAcrossFlats=parameters.nutAcrossFlats,notchWidth=parameters.notchWidth}={}){
 if(!Number.isFinite(nutAcrossFlats)||nutAcrossFlats<=0||!Number.isFinite(notchWidth)||notchWidth<=3.175||notchWidth>40)throw Error('Positive nut size and center clearance width between 3.175 and 40 mm required');
 let shape=buildPrismaticPart(stockProfile);
 const radius=1.5875,diagonal=radius/Math.sqrt(2),center=-193.675,left=center-notchWidth/2,right=center+notchWidth/2,a=left-radius,c=left+radius,e=right-radius,g=right+radius,z=96.8375;
 const outline=[{kind:'line',from:[a,105],to:[a,98.425]},{kind:'arc',from:[a,98.425],mid:[a+diagonal,z+diagonal],to:[left,z]},{kind:'arc',from:[left,z],mid:[c-diagonal,z-diagonal],to:[c,95.25]},{kind:'line',from:[c,95.25],to:[e,95.25]},{kind:'arc',from:[e,95.25],mid:[e+diagonal,z-diagonal],to:[right,z]},{kind:'arc',from:[right,z],mid:[g-diagonal,z+diagonal],to:[g,98.425]},{kind:'line',from:[g,98.425],to:[g,105]},{kind:'line',from:[g,105],to:[a,105]}];
 shape=unwrap(cut(shape,buildPrismaticPart({origin:[0,-125,0],normal:[0,-1,0],u:[1,0,0],v:[0,0,1],direction:[0,1,0],depth:50,outline,cutouts:[]})));
 for(const x of [-228.6,-158.75]){
  const y=-101.6,r=nutAcrossFlats/Math.sqrt(3),points=Array.from({length:6},(_,i)=>[x+r*Math.cos(i*Math.PI/3),y+r*Math.sin(i*Math.PI/3)]);
  shape=unwrap(cut(shape,buildPrismaticPart({origin:[0,0,73.02499],normal:[0,0,1],u:[1,0,0],v:[0,1,0],direction:[0,0,1],depth:25.40002,outline:points.map((from,i)=>({kind:'line',from,to:points[(i+1)%6]})),cutouts:[]})));
 }
 const edges=getEdges(shape).filter(edge=>{const q=getBounds(edge);return q.zMax-q.zMin<1e-5&&!(q.xMax-q.xMin<1e-5&&q.xMin>a-.001&&q.xMax<g+.001&&q.zMin>95);});
 return unwrap(fillet(shape,edges,radius));
}
