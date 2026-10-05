import {getEdges,getBounds,fillet,cut,translate,rotate,unwrap} from 'brepjs';
import {buildPrismaticPart} from './profile.js';

// Drive-base tie spacer. Hex bores preserve the two mounting interfaces;
// the shallow center relief clears the neighbouring structure. Build its
// S-shaped transition explicitly because opposing tangent rounds consume the
// entire relief depth; a generic simultaneous fillet is numerically unstable.
const referenceProfile={"origin":[0,0,73.025],"normal":[0,0,1],"u":[1,0,0],"v":[0,1,0],"direction":[0,0,1],"depth":25.4,"outline":[{"kind":"line","from":[27.1478700667,6.35],"to":[-27.1478700666,6.35]},{"kind":"arc","from":[-28.2588886285,6.8035714286],"mid":[-27.7478886675,6.4677605916],"to":[-27.1478700666,6.35]},{"kind":"arc","from":[-28.2588886285,6.8035714285],"mid":[-44.45,0],"to":[-28.2588886285,-6.8035714285]},{"kind":"arc","from":[-27.1478700666,-6.35],"mid":[-27.7478886675,-6.4677605916],"to":[-28.2588886285,-6.8035714286]},{"kind":"line","from":[-27.1478700666,-6.35],"to":[27.1478700667,-6.35]},{"kind":"arc","from":[28.2588886286,-6.8035714286],"mid":[27.7478886676,-6.4677605916],"to":[27.1478700667,-6.35]},{"kind":"arc","from":[28.2588886285,-6.8035714285],"mid":[44.45,0],"to":[28.2588886286,6.8035714286]},{"kind":"arc","from":[27.1478700667,6.35],"mid":[27.7478886676,6.4677605916],"to":[28.2588886286,6.8035714286]}],"cutouts":[]};
export function buildDriveSpacer({length,center,angle=0,nutAcrossFlats=9.5758,notchWidth}){
 if(!Number.isFinite(length)||length<50||!Number.isFinite(nutAcrossFlats)||nutAcrossFlats<=0||!Number.isFinite(notchWidth)||notchWidth<=3.175||notchWidth>length-30)throw Error('Invalid spacer dimensions or insufficient material around clearance');
 const endSpacing=length-19.05,extension=(endSpacing-69.85)/2;
 const stockProfile={...referenceProfile,outline:referenceProfile.outline.map(segment=>Object.fromEntries(Object.entries(segment).map(([key,value])=>[key,Array.isArray(value)?[value[0]+Math.sign(value[0])*extension,value[1]]:value])))};
 let shape=buildPrismaticPart(stockProfile);
 const radius=1.5875,diagonal=radius/Math.sqrt(2),left=-notchWidth/2,right=notchWidth/2,a=left-radius,c=left+radius,e=right-radius,g=right+radius,z=96.8375;
 const outline=[{kind:'line',from:[a,105],to:[a,98.425]},{kind:'arc',from:[a,98.425],mid:[a+diagonal,z+diagonal],to:[left,z]},{kind:'arc',from:[left,z],mid:[c-diagonal,z-diagonal],to:[c,95.25]},{kind:'line',from:[c,95.25],to:[e,95.25]},{kind:'arc',from:[e,95.25],mid:[e+diagonal,z-diagonal],to:[right,z]},{kind:'arc',from:[right,z],mid:[g-diagonal,z+diagonal],to:[g,98.425]},{kind:'line',from:[g,98.425],to:[g,105]},{kind:'line',from:[g,105],to:[a,105]}];
 shape=unwrap(cut(shape,buildPrismaticPart({origin:[0,-25,0],normal:[0,-1,0],u:[1,0,0],v:[0,0,1],direction:[0,1,0],depth:50,outline,cutouts:[]})));
 for(const x of [-endSpacing/2,endSpacing/2]){
  const y=0,r=nutAcrossFlats/Math.sqrt(3),points=Array.from({length:6},(_,i)=>[x+r*Math.cos(i*Math.PI/3),y+r*Math.sin(i*Math.PI/3)]);
  shape=unwrap(cut(shape,buildPrismaticPart({origin:[0,0,73.02499],normal:[0,0,1],u:[1,0,0],v:[0,1,0],direction:[0,0,1],depth:25.40002,outline:points.map((from,i)=>({kind:'line',from,to:points[(i+1)%6]})),cutouts:[]})));
 }
 const edges=getEdges(shape).filter(edge=>{const q=getBounds(edge);return q.zMax-q.zMin<1e-5&&!(q.xMax-q.xMin<1e-5&&q.xMin>a-.001&&q.xMax<g+.001&&q.zMin>95);});
 shape=unwrap(fillet(shape,edges,radius));
 return translate(angle?rotate(shape,angle):shape,[center[0],center[1],0]);
}
