import*as b from'brepjs';import{build022}from'./build022.js';import{buildPrismaticPart}from'./profile.js';import profile from'./bracket022-profile-data.js';import notch from'./bracket022-notch-original-edge.js';
export const parameters={holeScale:1};
// Work-in-progress reconstruction: not approved for the installed robot yet.
// Two rounded stock sections preserve the stepped mounting clearance. Local
// lofts describe the small blend where ordinary OCCT edge rounding fails.
export default function build({holeScale=1,frontMountHoleRadius=1.7272}={}){
 if(!Number.isFinite(holeScale)||holeScale<=0)throw Error('Invalid holeScale');
 const k=b.getKernel(),bodies=[];
 for(const front of[-196.9931036,-195.7231036]){
  const c=[-162.5586951228,-173.4981036],r=166.6875,x=y=>c[0]-Math.sqrt(r*r-(y-c[1])**2),back=-246.5231036;
  const outline=[{kind:'line',from:[-348.488,front],to:[-348.488,back]},{kind:'line',from:[-348.488,back],to:[x(back),back]},{kind:'arc',from:[x(back),back],mid:[x(-222),-222],to:[x(front),front]},{kind:'line',from:[x(front),front],to:[-348.488,front]}];
  let stock=b.getSolids(build022({...profile,outline},{holes:false,window:false}))[0];
  const edges=b.getEdges(stock).filter(e=>{const q=b.getBounds(e);return q.zMin<386.9181&&!(Math.abs(q.zMin-377.3932)<1e-5&&Math.abs(q.zMax-377.3932)<1e-5&&q.yMax-q.yMin>1);});
  bodies.push(b.unwrap(b.fillet(stock,edges,3.175)));
 }
 let s=b.unwrap(b.simplify(b.unwrap(b.fuse(bodies[0],b.unwrap(b.intersect(bodies[1],b.box(50,100,30,{at:[-310.661,-220,380]})))))));
 const window=buildPrismaticPart({...profile,origin:[0,0,371.6307],depth:16.2875,outline:profile.cutouts[0],cutouts:[]});s=b.unwrap(b.cut(s,window));
 const faces=k.makeCompound(b.getFaces(window).map(f=>f.wrapped));
 const edges=b.getEdges(s).filter(e=>{const q=b.getBounds(e);if(Math.abs(q.zMin-372.6307)>1e-5||Math.abs(q.zMax-372.6307)>1e-5)return false;const p=b.curvePointAt(e,.5),v=k.makeVertex(...p);try{return k.distance(v,faces).value<1e-5;}finally{k.dispose(v);}});
 s=b.unwrap(b.fillet(b.getSolids(s)[0],edges,.508));
 const clip=b.box(1.28,10,16,{at:[-335.66,-198,380],centered:true});
 const base=b.unwrap(b.cut(s,clip)),cap=notch();
 const interfaceFace=f=>{if(k.surfaceType(f)!=='plane')return false;const q=k.boundingBox(f);return (Math.abs(q.min[0]+336.3)<1e-5&&Math.abs(q.max[0]+336.3)<1e-5||Math.abs(q.min[0]+335.02)<1e-5&&Math.abs(q.max[0]+335.02)<1e-5)&&q.min[1]>=-203-1e-5||Math.abs(q.min[1]+203)<1e-5&&Math.abs(q.max[1]+203)<1e-5&&q.min[0]>=-336.3-1e-5&&q.max[0]<=-335.02+1e-5};
 const fs=[base,cap].flatMap(s=>k.iterShapes(s.wrapped,'face')).filter(f=>!interfaceFace(f)),shell=k.sew(fs,.0001);s=b.castShape(k.solidFromShell(shell));
 for(const[x,y]of[[-322.2346819876,-240.1731036],[-332.867,-200.4856036]])s=b.unwrap(b.cut(s,b.cylinder(y>-210?frontMountHoleRadius:1.7272*holeScale,16.2875,{at:[x,y,371.6307]})));
 s=b.translate(s,[342.138,240.1731036,-377.3932]);
 s=b.unwrap(b.cut(s,b.cylinder(1.7272*holeScale,16.2875,{at:[0,0,-5.7625]})));
 s=b.unwrap(b.cut(s,b.cylinder(1.7272*holeScale,60,{at:[0,-9.8268964,0],axis:[0,1,0]})));
 s=b.translate(s,[-342.138,-240.1731036,377.3932]);
 if(!k.isValid(s.wrapped)||b.getSolids(s).length!==1)throw Error('Invalid triangular bracket');return s;
}
