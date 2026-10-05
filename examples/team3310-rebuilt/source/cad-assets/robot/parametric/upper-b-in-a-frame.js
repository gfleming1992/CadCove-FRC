import * as b from 'brepjs';
import {buildPrismaticPart} from './profile.js';
const C=[-162.5586951228,-173.4981036],N=[-268.4195451227,-278.5779036],z=393.2682,top=399.6182;
const outline=[
 {kind:'line',from:[-7.7774451228,-174.8488591052],to:[-14.9268167063,-174.7864674846]},
 {kind:'arc',from:[-14.9268167063,-174.7864674846],mid:[-139.8838584032,-319.3839603031],to:[-302.834780041,-219.5356036]},
 {kind:'line',from:[-321.110133444,-219.5356036],to:[-302.834780041,-219.5356036]},
 {kind:'arc',from:[-321.110133444,-219.5356036],mid:[-168.5693844195,-338.4886536754],to:[-7.7774451228,-230.9504721192]},
 {kind:'line',from:[-7.7774451228,-230.9504721192],to:[-7.7774451228,-174.8488591052]},
];
export default function buildUpper({holeScale=1,stage=100,notchOrder='together'}={}){
 let s=buildPrismaticPart({origin:[0,0,z],normal:[0,0,1],u:[1,0,0],v:[0,1,0],direction:[0,0,1],depth:6.35,outline,cutouts:[]});
 // B retains the one-degree sector between its two split planes.
 const half=Math.PI/360,inside=147.6375,outside=154.78714382014;
 const xy=(r,a)=>[C[0]+r*Math.cos(a),C[1]+r*Math.sin(a)];
 const wedge=buildPrismaticPart({origin:[0,0,z],normal:[0,0,1],u:[1,0,0],v:[0,1,0],direction:[0,0,1],depth:6.35,outline:[{kind:'arc',from:xy(outside,-half),mid:xy(outside,0),to:xy(outside,half)},{kind:'line',from:xy(outside,half),to:xy(inside,half)},{kind:'arc',from:xy(inside,half),mid:xy(inside,0),to:xy(inside,-half)},{kind:'line',from:xy(inside,-half),to:xy(outside,-half)}],cutouts:[]});
 s=b.unwrap(b.simplify(b.unwrap(b.fuse(s,wedge))));
 // The large left-end roll is a true cylindrical stock limit, not a polygonal approximation.
 const rollCenter=-310.9899451227,limiter=b.unwrap(b.fuse(b.box(400,400,20,{at:[rollCenter+200,-250,z+10]}),b.cylinder(6.35,400,{at:[rollCenter,-450,z],axis:[0,1,0]})));
 s=b.unwrap(b.intersect(s,limiter));
 if(stage===0)return s;
 for(const [r,depth,z0]of[[11.1506,6.35,z]])s=b.unwrap(b.cut(s,b.cylinder(r,depth,{at:[...N,z0]})));
 if(stage===1)return s;
 // Both rims have a 1/16-inch bevel.
 for(const [r0,r1,z0]of[[163.5125,165.1,z],[165.1,163.5125,398.0307]]){
 const tool=b.unwrap(b.cut(b.cylinder(180,1.5875,{at:[...C,z0]}),b.cone(r0,r1,1.5875,{at:[...C,z0]})));s=b.unwrap(b.cut(s,tool));
 }
 if(stage===2)return s;
 if(notchOrder==='inner-first'){const edges=b.getEdges(s).filter(e=>{const q=b.getBounds(e),p=b.curvePointAt(e,.5);return Math.abs(q.zMin-top)<1e-4&&Math.abs(q.zMax-top)<1e-4&&Math.abs(Math.hypot(p[0]-C[0],p[1]-C[1])-147.6375)<1e-4;});s=b.unwrap(b.fillet(s,edges,1.016));}
 const rounded=b.getEdges(s).filter(e=>{const q=b.getBounds(e),p=b.curvePointAt(e,.5);const onCap=Math.abs(q.yMin+219.5356036)<1e-4&&Math.abs(q.yMax+219.5356036)<1e-4;const notch=Math.hypot(p[0]-N[0],p[1]-N[1]);const vertical=q.xMax-q.xMin<1e-5&&q.yMax-q.yMin<1e-5&&q.zMax-q.zMin>1;const notchTop=Math.abs(q.zMin-top)<1e-5&&Math.abs(q.zMax-top)<1e-5;return Math.abs(notch-11.1506)<1e-4&&(vertical||notchTop);});
 if((notchOrder==='together'||notchOrder==='inner-first'))s=b.unwrap(b.fillet(s,rounded,1.5875));else{
 const select=kind=>b.getEdges(s).filter(e=>{const q=b.getBounds(e),p=b.curvePointAt(e,.5);if(Math.abs(Math.hypot(p[0]-N[0],p[1]-N[1])-11.1506)>1e-4)return false;return kind==='top'?Math.abs(q.zMin-top)<1e-5&&Math.abs(q.zMax-top)<1e-5:q.xMax-q.xMin<1e-5&&q.yMax-q.yMin<1e-5&&q.zMax-q.zMin>1;});
 for(const kind of(notchOrder==='top-first'?['top','vertical']:['vertical','top'])){const edges=select(kind);if(!edges.length)throw Error('Missing notch '+kind);s=b.unwrap(b.fillet(s,edges,1.5875));}
 }
 if(stage===3)return s;
 s=b.unwrap(b.cut(s,b.cylinder(12.7,1.778,{at:[...N,z]})));
 if(stage===4)return s;
 const holes=[[-307.7579121511,-233.641588539],[-222.7021800618,-318.6973206283],[-102.4152101837,-318.6973206283],[-51.42802562456,-284.6287730982],[-17.35947809449,-233.641588539]];
 for(const [x,y]of holes){s=b.unwrap(b.cut(s,b.cylinder(2.4892*holeScale,6.35,{at:[x,y,z]})));s=b.unwrap(b.cut(s,b.cylinder(4.7625*holeScale,top-394.7922,{at:[x,y,394.7922]})));}
 return s;
}
