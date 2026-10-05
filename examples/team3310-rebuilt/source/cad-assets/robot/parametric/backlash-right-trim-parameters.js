import source from './backlash-right-pcurve-data.js';
const axis=[Math.sqrt(3)/2,0,-.5],tangent=[.5,0,Math.sqrt(3)/2],radius=14.2875,dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function hubPoint(p,scale){if(scale===1)return [...p];const hub=[314.325,Math.abs(p[1]-9.525)<Math.abs(p[1]-22.225)?9.525:22.225,182.0333418],q=p.map((v,i)=>v-hub[i]),side=Math.sign(dot(q,axis)),t=dot(q,tangent)*scale,r2=radius*radius-t*t;if(r2<=0)throw Error('Drill exceeds hub radius');const r=side*Math.sqrt(r2);return[hub[0]+r*axis[0]+t*tangent[0],hub[1]+q[1]*scale,hub[2]+r*axis[2]+t*tangent[2]];}
export default function trims({holeScale=1,hubLength=25.4}={}){
 if(!Number.isFinite(holeScale)||holeScale<=0||!Number.isFinite(hubLength)||hubLength<=0)throw Error('Positive clearance and hub length required');
 return source.map(s=>{const d=structuredClone(s),isHub=d.index===0,delta=hubLength-25.4;if(isHub)d.origin[1]+=delta;else d.radius*=holeScale;
 const borePoint=p=>{const q=p.map((v,i)=>v-d.origin[i]),a=[d.linear[2],d.linear[5],d.linear[8]],axial=dot(q,a);return d.origin.map((v,i)=>v+axial*a[i]+(q[i]-axial*a[i])*holeScale);};
 for(const e of d.edges){if(e.type==='pcurve')e.points=e.points.map(p=>hubPoint(p,holeScale));else if(isHub&&e.points)e.points=e.points.map(p=>p.map((v,i)=>i===1&&Math.abs(v-26.9875)<1e-6?v+delta:v));else if(!isHub&&e.type==='circleFull')e.radius*=holeScale;else if(!isHub&&e.points)e.points=e.points.map(p=>Math.abs(Math.hypot(p[0]-314.325,p[2]-182.0333418)-radius)<1e-6?hubPoint(p,holeScale):borePoint(p));}return d;});
}
