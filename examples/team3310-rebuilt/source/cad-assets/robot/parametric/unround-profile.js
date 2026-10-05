// Offline recovery of the intersections hidden by a known sketch fillet.
export function unroundProfile(profile,radius){
 const p=structuredClone(profile),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const circle=e=>{const[a,b,c]=[e.from,e.mid,e.to],d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1])),s=q=>q[0]**2+q[1]**2,center=[(s(a)*(b[1]-c[1])+s(b)*(c[1]-a[1])+s(c)*(a[1]-b[1]))/d,(s(a)*(c[0]-b[0])+s(b)*(a[0]-c[0])+s(c)*(b[0]-a[0]))/d];return{center,r:dist(a,center)};};
 const small=p.outline.filter(e=>e.kind==='arc'&&Math.abs(circle(e).r-radius)<1e-4);
 for(const arc of small){const ends=[arc.from,arc.to],neighbors=p.outline.filter(e=>e!==arc&&[e.from,e.to].some(q=>ends.some(v=>dist(q,v)<1e-6)));if(neighbors.length!==2)throw Error('Expected 2 adjacent curves');let candidates=[];
 const lines=neighbors.filter(e=>e.kind==='line');if(lines.length===2){const [a,b]=lines,u=[a.to[0]-a.from[0],a.to[1]-a.from[1]],v=[b.to[0]-b.from[0],b.to[1]-b.from[1]],w=[b.from[0]-a.from[0],b.from[1]-a.from[1]],t=(w[0]*v[1]-w[1]*v[0])/(u[0]*v[1]-u[1]*v[0]);candidates=[[a.from[0]+t*u[0],a.from[1]+t*u[1]]];}
 else if(lines.length===1){const a=lines[0],c=circle(neighbors.find(e=>e!==a)),u=[a.to[0]-a.from[0],a.to[1]-a.from[1]],w=[a.from[0]-c.center[0],a.from[1]-c.center[1]],aa=u[0]**2+u[1]**2,bb=2*(u[0]*w[0]+u[1]*w[1]),cc=w[0]**2+w[1]**2-c.r**2,disc=bb*bb-4*aa*cc;if(disc<0)throw Error('No hidden line-circle intersection');candidates=[-1,1].map(sign=>{const t=(-bb+sign*Math.sqrt(disc))/(2*aa);return[a.from[0]+t*u[0],a.from[1]+t*u[1]];});}
 else {const a=circle(neighbors[0]),b=circle(neighbors[1]),dx=b.center[0]-a.center[0],dy=b.center[1]-a.center[1],d=Math.hypot(dx,dy),x=(a.r*a.r-b.r*b.r+d*d)/(2*d),h2=a.r*a.r-x*x;if(h2<0||!d)throw Error('No hidden circle-circle intersection');const h=Math.sqrt(h2),p=[a.center[0]+x*dx/d,a.center[1]+x*dy/d];candidates=[-1,1].map(sign=>[p[0]-sign*h*dy/d,p[1]+sign*h*dx/d]);}candidates.sort((a,b)=>dist(a,arc.mid)-dist(b,arc.mid));const corner=candidates[0];if(!corner.every(Number.isFinite)||dist(corner,arc.mid)>5*radius)throw Error('Unreasonable recovered corner');for(const e of neighbors)for(const key of ['from','to'])if(ends.some(v=>dist(e[key],v)<1e-6))e[key]=corner;p.outline.splice(p.outline.indexOf(arc),1);
 }
 return p;
}
