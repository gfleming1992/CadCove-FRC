import{canonicalizeProfiles,buildProfile}from'./backlash-right-profile.js';
import*as b from'brepjs';import{buildPrismaticPart}from'./profile.js';import data from'./backlash-right-stock-data.js';
export const parameters={holeScale:1,hubLength:25.4};
export default function build({holeScale=1,hubLength=25.4,edgeRadius=1.5875,stockOnly=false,inspect=()=>{}}={}){
 const k=b.getKernel(),plate=structuredClone({...data.plate,origin:[0,-11.938,0],depth:6.35,cutouts:[]}),corners=[];
 for(const arc of plate.outline.filter(e=>e.kind==='arc'&&Math.hypot(e.to[0]-e.from[0],e.to[1]-e.from[1])<3)){
  const near=(a,c)=>Math.hypot(a[0]-c[0],a[1]-c[1])<1e-5,adjacent=plate.outline.filter(e=>e.kind==='line'&&[e.from,e.to].some(p=>near(p,arc.from)||near(p,arc.to)));if(adjacent.length!==2)throw Error('Corner adjacency');
  const[a,c]=adjacent,p=a.from,r=a.to.map((v,i)=>v-p[i]),q=c.from,s=c.to.map((v,i)=>v-q[i]),cross=(a,b)=>a[0]*b[1]-a[1]*b[0],t=cross(q.map((v,i)=>v-p[i]),s)/cross(r,s),corner=p.map((v,i)=>v+t*r[i]);
  for(const e of adjacent)for(const key of['from','to'])if(near(e[key],arc.from)||near(e[key],arc.to))e[key]=corner;corners.push(corner);plate.outline.splice(plate.outline.indexOf(arc),1);
 }

 // The lower flat is machined after the sloping rim has been rounded.
 const flat=plate.outline.find(e=>e.kind==='line'&&Math.abs(e.from[0]-165.1)<1e-6&&Math.abs(e.to[0]-165.1)<1e-6),slope=plate.outline.find(e=>e.kind==='line'&&e!==flat&&[e.from,e.to].some(p=>Math.hypot(p[0]-165.1,p[1]-339.725)<1e-6)),arc=plate.outline.find(e=>e.kind==='arc'&&[e.from,e.to].some(p=>Math.hypot(p[0]-165.1,p[1]-355.423229104)<1e-6));
 if(!flat||!slope||!arc)throw Error('Expected pre-cut rim');
 const a=slope.from,d=slope.to.map((v,i)=>v-a[i]),center=[182.0333418,314.325],q=a.map((v,i)=>v-center[i]),A=d[0]**2+d[1]**2,B=2*(q[0]*d[0]+q[1]*d[1]),C=q[0]**2+q[1]**2-44.45**2,t=(-B+Math.sqrt(B*B-4*A*C))/(2*A),hit=a.map((v,i)=>v+t*d[i]);
 const near=(a,c)=>Math.hypot(a[0]-c[0],a[1]-c[1])<1e-5;
 for(const key of ['from','to'])if(near(slope[key],[165.1,339.725]))slope[key]=hit;
 for(const key of ['from','to'])if(near(arc[key],[165.1,355.423229104]))arc[key]=hit;
 const theta0=Math.atan2(arc.from[0]-center[0],arc.from[1]-center[1]),theta1=Math.atan2(arc.to[0]-center[0],arc.to[1]-center[1]),delta=((theta1-theta0+Math.PI*3)%(2*Math.PI))-Math.PI,theta=theta0+delta/2;arc.mid=[center[0]+44.45*Math.sin(theta),center[1]+44.45*Math.cos(theta)];plate.outline.splice(plate.outline.indexOf(flat),1);
 corners.push([220.3530340703,336.8506228396]);
 const webProfile=structuredClone(data.web);canonicalizeProfiles([plate,webProfile]);
 const roundPlate=p=>{const shape=buildProfile(p),edges=b.getEdges(shape).filter(e=>{const q=b.getBounds(e);return q.yMax-q.yMin<1e-5||corners.some(p=>Math.abs(q.zMin-p[0])<1e-5&&Math.abs(q.xMin-p[1])<1e-5&&q.zMax-q.zMin<1e-5&&q.xMax-q.xMin<1e-5);});return b.unwrap(b.fillet(shape,edges,edgeRadius));};
 let rear=roundPlate(plate);
 rear=b.unwrap(b.intersect(rear,buildPrismaticPart({...data.plateTrim,origin:[0,-11.93801,0],depth:6.35002,cutouts:[]})));inspect({phase:"rear-rounded",shape:rear});
 const slab=(low,high)=>b.box(200,high-low,200,{at:[330,(low+high)/2,190],centered:true});
 const front=b.unwrap(b.fuse(b.translate(b.unwrap(b.intersect(rear,slab(-11.938,-11.938+edgeRadius))),[0,11.938,0]),b.translate(b.unwrap(b.intersect(rear,slab(-5.588-edgeRadius,-5.588))),[0,8.763,0])));inspect({phase:"front-rounded",shape:front});
 const web=buildProfile({...webProfile,origin:[0,-11.938+edgeRadius,0],depth:15.113-2*edgeRadius});
 let hub=b.cylinder(14.2875,hubLength,{at:[314.325,3.175,182.0333418],axis:[0,1,0]});
 hub=b.unwrap(b.fillet(hub,b.getEdges(hub).filter(e=>{const q=b.getBounds(e);return q.yMax-q.yMin<1e-5&&Math.abs(q.yMin-(3.175+hubLength))<1e-5;}),edgeRadius));
 let shape=b.unwrap(b.simplify(b.unwrap(b.fuseAll([rear,front,web,hub]))));inspect({phase:"rounded-stock",shape});if(stockOnly)return shape;
 const cuts=[buildPrismaticPart({...data.plate,origin:[0,-11.93801,0],depth:11.938+3.175+hubLength+.00002,outline:data.plate.cutouts[0],cutouts:[]})];
 for(const outline of data.plate.cutouts.slice(1))cuts.push(buildPrismaticPart({...plate,origin:[0,-11.93801,0],depth:15.11302,outline,cutouts:[]}));
 for(const outline of data.pockets)cuts.push(buildPrismaticPart({...plate,origin:[0,-11.93801,0],depth:3.17502,outline,cutouts:[]}));
 for(const h of data.holes)cuts.push(b.cylinder(h.radius*holeScale,h.length+.00002,{at:h.at.map((v,i)=>v-h.axis[i]*.00001),axis:h.axis}));
 for(const c of cuts)shape=b.unwrap(b.cut(shape,c));return shape;
}
