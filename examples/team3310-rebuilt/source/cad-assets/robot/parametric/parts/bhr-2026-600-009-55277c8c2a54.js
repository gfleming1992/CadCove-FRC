import * as b from 'brepjs';
import {buildPrismaticPart} from '../profile.js';
export const parameters={holeScale:1};
// Turret retaining strap: curved rear seat, bridge clearance, softened edges,
// and two mounting bores. Dimensions are millimetres in the assembly datum.
export default function build({holeScale=parameters.holeScale}={}){
 if(!Number.isFinite(holeScale)||holeScale<=0)throw Error('holeScale must be positive');
 let shape=buildPrismaticPart(profile);
 shape=b.unwrap(b.intersect(shape,b.cylinder(127.7874,100,{at:[-162.5586951227,-173.4981036,412.9057]})));
 const sharp=e=>{const fs=b.facesOfEdge(shape,e);if(fs.length!==2)return false;const p=b.curvePointAt(e,.5),ns=fs.map(f=>b.normalAt(f,p));return Math.abs(ns[0].reduce((s,v,i)=>s+v*ns[1][i],0))<.999;};
 const primary=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.xMax-q.xMin<1e-5&&q.yMax-q.yMin<1e-5&&sharp(e);});
 shape=b.unwrap(b.fillet(shape,primary,3.175));
 const secondary=b.getEdges(shape).filter(e=>b.getBounds(e).zMax>413.9057+1e-5&&sharp(e));
 shape=b.unwrap(b.fillet(shape,secondary,.79375));
 for(const h of holes)shape=b.unwrap(b.cut(shape,b.cylinder(h.radius*holeScale,h.length+.00002,{at:h.at.map((v,i)=>v-.00001*h.axis[i]),axis:h.axis})));
 return shape;
}
const profile={"origin":[-291,0,0],"normal":[1,0,0],"u":[0,1,0],"v":[0,0,1],"direction":[1,0,0],"depth":15.189560796600006,"outline":[{"kind":"line","from":[-202.1157509512,413.9057],"to":[-179.8481036,413.9057]},{"kind":"line","from":[-179.8481036,413.9057],"to":[-179.8481036,418.9857]},{"kind":"arc","from":[-167.1481036,418.9857],"mid":[-173.4981036,425.3357],"to":[-179.8481036,418.9857]},{"kind":"line","from":[-167.1481036,413.9057],"to":[-167.1481036,418.9857]},{"kind":"line","from":[-167.1481036,413.9057],"to":[-144.8804562487,413.9057]},{"kind":"line","from":[-144.8804562487,420.2557],"to":[-144.8804562487,413.9057]},{"kind":"line","from":[-158.2581036,420.2557],"to":[-144.8804562487,420.2557]},{"kind":"arc","from":[-161.3061036,422.5417],"mid":[-160.1631036,420.8907],"to":[-158.2581036,420.2557]},{"kind":"arc","from":[-161.3061036,422.5417],"mid":[-173.4981036,431.6857],"to":[-185.6901036,422.5417]},{"kind":"arc","from":[-188.7381036,420.2557],"mid":[-186.8331036,420.8907],"to":[-185.6901036,422.5417]},{"kind":"line","from":[-188.7381036,420.2557],"to":[-202.1157509512,420.2557]},{"kind":"line","from":[-202.1157509512,420.2557],"to":[-202.1157509512,413.9057]}],"cutouts":[]};
const holes=[{"at":[-280.8904392034,-197.0357509512,413.90569999999997],"axis":[0,0,1],"radius":2.5527,"length":6.350000000000023},{"at":[-280.8904392034,-149.9604562487,413.90569999999997],"axis":[0,0,1],"radius":2.5527,"length":6.350000000000023}];
