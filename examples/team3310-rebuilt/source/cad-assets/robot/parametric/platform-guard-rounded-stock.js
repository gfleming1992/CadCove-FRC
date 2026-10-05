import * as b from 'brepjs';
import stock from './platform-guard-cut-stock.js';
import holes from './platform-guard-holes.js';
import targets from './platform-guard-round-targets.js';
export const parameters={baseThickness:6.35,wallHeight:25.4,holeScale:1};
export default function build({baseThickness=6.35,wallHeight=25.4,holeScale=1,smallRounds=true}={}){
 const k=b.getKernel();let shape=b.getSolids(b.castShape(k.simplify(stock({baseThickness,wallHeight,holeScale,drill:false}).wrapped)))[0];
 for(const group of['vertical','base']){const edges=b.getEdges(shape),chosen=targets.filter(t=>t.group===group&&Math.abs(t.xy[1]+168.9261036)>1e-5).map(t=>{const point=k.makeVertex(...t.xy,393.2682+baseThickness+(group==='vertical'?wallHeight/2:0));try{return edges.find(e=>k.distance(point,e.wrapped).value<1e-5)}finally{k.dispose(point)}});if(chosen.some(e=>!e))throw Error('Missing '+group+' round edges');shape=b.unwrap(b.fillet(shape,chosen,3.175));}
 // Roll the conical rib caps after the supporting vertical and floor fillets.
 const capEdges=b.getEdges(shape).filter(e=>{if(b.getCurveType(e)!=='CIRCLE')return false;const p=b.curvePointAt(e,.5),r=Math.hypot(p[0]+162.5586951227978,p[1]+173.4981036);return Math.abs(r-180.18125)<1e-5&&Math.abs(p[2]-(393.2682+baseThickness+3.175))<1e-5||Math.abs(r-169.59891182775)<1e-5&&Math.abs(p[2]-(393.2682+baseThickness+wallHeight))<1e-5;});shape=b.unwrap(b.fillet(shape,capEdges,3.175));
 shape=b.getSolids(b.castShape(k.simplify(shape.wrapped)))[0];if(smallRounds){const cx=-162.5586951227978,cy=-173.4981036,cutY=-171.161095874;const chosen=b.getEdges(shape).filter(e=>{const p=b.curvePointAt(e,.5);if(Math.abs(Math.hypot(p[0]-cx,p[1]-cy)-165.1)<1e-5&&Math.abs(p[2]-(393.2682+baseThickness+wallHeight))<1e-5)return false;if(Math.abs(p[1]-cutY)<1e-5||Math.abs(-(p[0]-cx)*Math.sqrt(3)/2+(p[1]-cy)/2+.127)<1e-5||p[2]<393.2682+1e-5)return false;const fs=b.facesOfEdge(shape,e);if(fs.length!==2)return false;const ns=fs.map(f=>b.normalAt(f,p));return Math.abs(ns[0].reduce((s,v,i)=>s+v*ns[1][i],0))<.9999;});
 // The end rib has intersecting concave and convex contours. Round its
 // inner corner first, then its top and outer boundary; OCCT cannot solve
 // these in one group. Witnesses are collected from the editable stock.
 const witnesses=chosen.map(e=>({point:b.curvePointAt(e,.5),type:b.getCurveType(e)}));
 const end=w=>w.point[0]>0&&w.point[1]<-150;
 const near=(a,z)=>Math.abs(a-z)<1e-5;
 const inner=w=>end(w)&&w.type==='LINE'&&near(w.point[1],-168.9261036)&&w.point[0]<5&&w.point[2]<393.2682+baseThickness+wallHeight-1;
 const top=w=>end(w)&&w.type==='LINE'&&near(w.point[1],-168.9261036)&&near(w.point[2],393.2682+baseThickness+wallHeight);
 const outer=w=>end(w)&&w.type==='LINE'&&near(w.point[0],16.1951097544046)&&w.point[2]<393.2682+baseThickness;
 const groups=[witnesses.filter(inner),witnesses.filter(top),witnesses.filter(outer),witnesses.filter(w=>end(w)&&near(w.point[0],16.1951097544046)&&!outer(w)),witnesses.filter(w=>!end(w))];
 if(groups.slice(0,3).some(g=>g.length!==1))throw Error('Unexpected end rib contour topology');
 for(const group of groups){const edges=b.getEdges(shape),selected=[];for(const w of group){const v=k.makeVertex(...w.point);try{const e=edges.find(e=>b.getCurveType(e)===w.type&&k.distance(v,e.wrapped).value<1e-5);if(e)selected.push(e);}finally{k.dispose(v)}}if(selected.length)shape=b.unwrap(b.fillet(shape,selected,1));}
}
 for(const h of holes)shape=b.unwrap(b.cut(shape,b.cylinder(h.radius*holeScale,baseThickness+.002,{at:[...h.center,393.2672]})));
 return shape;
}
