import*as b from'brepjs';import lower from'./lower-b-in-a-frame.js';import upper from'./upper-b-in-a-frame.js';
const C=[-162.5586951228,-173.4981036],N=[-268.4195451227,-278.5779036],z=393.2682,top=399.6182;
const radius=p=>Math.hypot(p[0]-C[0],p[1]-C[1]);
export default function build({holeScale=1,nutAcrossFlats=9.779,stage=100,notchOrder='together',report=()=>{}}={}){
 let s=b.unwrap(b.simplify(b.unwrap(b.fuse(lower({holeScale,nutAcrossFlats}),upper({stage:3,notchOrder})))));
 s=b.unwrap(b.cut(s,b.cylinder(12.7,1.778,{at:[...N,z]})));
 const rounded=b.getEdges(s).filter(e=>{const q=b.getBounds(e),p=b.curvePointAt(e,.5),flat=q.zMax-q.zMin<1e-5;const onCap=Math.abs(q.yMin+219.5356036)<1e-4&&Math.abs(q.yMax+219.5356036)<1e-4&&!(flat&&Math.abs(q.zMin-z)<1e-4&&q.xMin> -310);const outerBottom=flat&&Math.abs(q.zMin-z)<1e-4&&Math.abs(q.xMin+317.3399451227)<1e-4&&Math.abs(q.xMax+317.3399451227)<1e-4;const notch=Math.hypot(p[0]-N[0],p[1]-N[1]);const vertical=q.xMax-q.xMin<1e-5&&q.yMax-q.yMin<1e-5&&q.zMax-q.zMin>1;const notchTop=Math.abs(q.zMin-top)<1e-5&&Math.abs(q.zMax-top)<1e-5;return onCap||outerBottom;});
 report('primary rounds',rounded.length);s=b.unwrap(b.fillet(s,rounded,1.5875));if(stage===1)return s;
 const innerTop=b.getEdges(s).filter(e=>{const q=b.getBounds(e);return Math.abs(q.zMin-top)<1e-4&&Math.abs(q.zMax-top)<1e-4&&b.getCurveType(e)==='CIRCLE'&&Math.abs(radius(b.curvePointAt(e,.5))-147.6375)<1e-4;});
 report('inner top',innerTop.length);if(!innerTop.length)throw Error('Missing inner top arcs');s=b.unwrap(b.fillet(s,innerTop,1.016));if(stage===2)return s;
 const root=b.getEdges(s).filter(e=>{const q=b.getBounds(e);return Math.abs(q.zMin-z)<1e-4&&Math.abs(q.zMax-z)<1e-4&&q.xMax< -270&&b.getCurveType(e)==='CIRCLE'&&Math.abs(radius(b.curvePointAt(e,.5))-147.6375)<1e-4;});
 report('left root',root.length);if(!root.length)throw Error('Missing left root');s=b.unwrap(b.fillet(s,root,1.016));if(stage===3)return s;
 s=b.unwrap(b.cut(s,b.cylinder(12.7,1.778,{at:[...N,z]})));
 const holes=[[-307.7579121511,-233.641588539],[-222.7021800618,-318.6973206283],[-102.4152101837,-318.6973206283],[-51.42802562456,-284.6287730982],[-17.35947809449,-233.641588539]];
 for(const [x,y]of holes){s=b.unwrap(b.cut(s,b.cylinder(2.4892*holeScale,6.35,{at:[x,y,z]})));s=b.unwrap(b.cut(s,b.cylinder(4.7625*holeScale,top-394.7922,{at:[x,y,394.7922]})));}
 return s;
}
