import*as b from'brepjs';import{buildPrismaticPart}from'./profile.js';import{unroundProfile}from'./unround-profile.js';
export function build022(profile,{holeScale=1,rounds=[],window=true,holes=true,notchRound=false}={}){
 const p=notchRound?structuredClone(profile):unroundProfile(profile,.508);p.cutouts=[];
 let s=buildPrismaticPart(p);
 const cx=-342.138,cz=377.3932,r=6.35,z0=372.6307,z1=386.9182,x0=-348.488,x1=-310,xe=cx-Math.sqrt(r*r-(z0-cz)**2),a=Math.atan2(z0-cz,xe-cx),am=(a-Math.PI)/2;
 const points=[[x0,z1],[x1,z1],[x1,z0],[xe,z0]],edges=points.slice(1).map((p,i)=>({kind:'line',from:points[i],to:p}));edges.push({kind:'arc',from:[xe,z0],mid:[cx+r*Math.cos(am),cz+r*Math.sin(am)],to:[x0,cz]},{kind:'line',from:[x0,cz],to:[x0,z1]});
 const limiter=buildPrismaticPart({origin:[0,-250,0],normal:[0,-1,0],u:[1,0,0],v:[0,0,1],direction:[0,1,0],depth:60,outline:edges,cutouts:[]});s=b.unwrap(b.intersect(s,limiter));
 if(window)s=b.unwrap(b.cut(s,buildPrismaticPart({...profile,origin:[0,0,z0-1],depth:16.2875,outline:profile.cutouts[0],cutouts:[]})));
 if(holes){for(const[x,y]of[[-322.2346819876,-240.1731036],[-342.138,-240.1731036],[-332.867,-200.4856036]])s=b.unwrap(b.cut(s,b.cylinder(1.7272*holeScale,16.2875,{at:[x,y,z0-1]})));s=b.unwrap(b.cut(s,b.cylinder(1.7272*holeScale,60,{at:[cx,-250,cz],axis:[0,1,0]})));}
 for(const{radius,select}of rounds){const es=b.getEdges(s).filter(select);if(!es.length)throw Error('No edges selected');s=b.unwrap(b.fillet(s,es,radius));}
 return s;
}
