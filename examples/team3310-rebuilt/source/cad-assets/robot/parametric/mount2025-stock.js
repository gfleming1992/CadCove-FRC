import {getEdges,getBounds,fillet,cut,compound,cylinder,curveLength,curvePointAt,curveIsClosed,getCurveType,unwrap} from 'brepjs';
import {buildPrismaticPart} from './profile.js';
// BHR-2025-100-022: 35-degree equipment mount with a clearance window.
// The base mounting centers and tilted mounting surface define the mating
// interfaces. Window length can change independently of screw clearance.
export const parameters={holeScale:1,windowLength:28.07169823564132};
export const stockProfile={"origin":[-285.75,0,0],"normal":[1,0,0],"u":[0,1,0],"v":[0,0,1],"direction":[1,0,0],"depth":63.5,"outline":[{"kind":"line","from":[279.4,152.4],"to":[311.15,152.4]},{"kind":"line","from":[311.15,152.4],"to":[311.15,158.7499999999905]},{"kind":"line","from":[311.15,158.7499999999905],"to":[248.73061422517057,202.45652444994207]},{"kind":"line","from":[248.73061422517057,202.45652444994207],"to":[245.08840385434334,197.2549089687092]},{"kind":"line","from":[245.08840385434334,197.2549089687092],"to":[291.0103730049836,165.1]},{"kind":"line","from":[291.0103730049836,165.1],"to":[279.4,165.1]},{"kind":"line","from":[279.4,165.1],"to":[279.4,152.4]}],"cutouts":[]};
export const windowFrame={"origin":[-279.4,261.10552523145935,186.03958763228968],"normal":[0,0.5735764363510113,0.8191520442890162],"u":[1,0,0],"v":[0,0.8191520442890162,-0.5735764363510113],"direction":[0,0.5735764363510113,0.8191520442890162],"depth":6.35002};
export const screwHoles=[{"radius":2.5527,"at":[-279.4,304.8,158.75],"axis":[0,0,-1],"length":6.35},{"radius":2.5527,"at":[-228.6,304.8,158.75],"axis":[0,0,-1],"length":6.35},{"radius":2.4892,"at":[-241.3,253.30310774536252,191.50291138005838],"axis":[0,0.5735764363510043,0.8191520442890123],"length":6.35},{"radius":2.4892,"at":[-267.97,299.7053664073126,159.0117000750085],"axis":[0,0.5735764363510043,0.8191520442890123],"length":6.35}];
const cornerRadius=5.08,edgeRound=1.5875,frontPlane=308.5086952014907;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function buildRoundedStock({holeScale=parameters.holeScale,windowLength=parameters.windowLength}={}){
 if(!Number.isFinite(holeScale)||holeScale<=0||!Number.isFinite(windowLength)||windowLength<=2*cornerRadius)throw Error('Positive screw clearance and a window longer than its corner diameter are required');
 let s=buildPrismaticPart(stockProfile);
 const endCorners=getEdges(s).filter(e=>{const q=getBounds(e);return Math.abs(q.xMax-q.xMin)<1e-5&&(Math.abs(q.yMin-279.4)<1e-5&&Math.abs(q.yMax-279.4)<1e-5||Math.abs(q.yMin-311.15)<1e-5&&Math.abs(q.yMax-311.15)<1e-5||Math.abs(q.yMin-245.08840385434334)<1e-5&&q.yMax<249);});
 s=unwrap(fillet(s,endCorners,cornerRadius));
 const p=[[0,0],[50.8,0],[50.8,windowLength],[0,windowLength]];
 let cutter=buildPrismaticPart({...windowFrame,outline:p.map((from,i)=>({kind:'line',from,to:p[(i+1)%4]})),cutouts:[]});
 cutter=unwrap(fillet(cutter,getEdges(cutter).filter(e=>Math.abs(curveLength(e)-windowFrame.depth)<1e-5),cornerRadius));
 s=unwrap(cut(s,cutter));s=unwrap(fillet(s,getEdges(s),edgeRound));
 return s;
}
export function finishMount(s,{holeScale=parameters.holeScale}={}){
 s=unwrap(cut(s,compound(screwHoles.map(h=>cylinder(h.radius*holeScale,h.length+.00002,{at:h.at.map((v,i)=>v-h.axis[i]*.00001),axis:h.axis})))));
 const mouths=getEdges(s).filter(e=>{if(getCurveType(e)!=='CIRCLE'||!curveIsClosed(e))return false;const a=curvePointAt(e,0),c=curvePointAt(e,.5),r=Math.hypot(...a.map((v,i)=>v-c[i]))/2;if(![2.5527,2.4892].some(v=>Math.abs(v*holeScale-r)<1e-5))return false;return [a,c].every(p=>Math.abs(p[2]-152.4)<1e-5)||[a,c].every(p=>Math.abs(dot(p,windowFrame.normal)-frontPlane)<1e-5);});
 s=unwrap(fillet(s,mouths,edgeRound));
 return unwrap(cut(s,compound([-279.4,-228.6].map(x=>cylinder(4.7625*holeScale,20,{at:[x,304.8,158.75]})))));
}

export default function build(options={}){return finishMount(buildRoundedStock(options),options);}
