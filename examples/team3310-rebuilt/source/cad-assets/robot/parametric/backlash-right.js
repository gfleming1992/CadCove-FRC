import * as b from 'brepjs';
import build from './backlash-right-trimmed.js';
// Normalize generated trim curves before publishing the editable solid.
function normalize(shape){const k=b.getKernel();try{const results=k.importSTEP(k.exportSTEP([shape.wrapped]));if(results.length!==1)throw Error('Expected one rebuilt backlash solid');return b.castShape(results[0]);}finally{k.dispose(shape.wrapped);}}
export default function model({holeScale=1,hubLength=25.4}={}){
 const rimRadius=1.5875,baseY=3.175,upperDrillY=22.225,drillRadius=4.445*holeScale;
 if(!Number.isFinite(holeScale)||holeScale<=0||!Number.isFinite(hubLength)||hubLength<=rimRadius)throw Error('Positive bore scale and a hub longer than its rim radius are required');
 // Keep complete surface-space drill loops while rebuilding; intersect the
 // shortened rounded cap afterwards so OCCT creates any new opening topology.
 const supportLength=Math.max(hubLength,upperDrillY+drillRadius+rimRadius-baseY+.1);
 let shape=normalize(build({holeScale,hubLength:supportLength}));
 if(supportLength===hubLength)return shape;
 let cap=b.cylinder(14.2875,hubLength,{at:[314.325,baseY,182.0333418],axis:[0,1,0]});
 const top=baseY+hubLength;
 cap=b.unwrap(b.fillet(cap,b.getEdges(cap).filter(e=>{const q=b.getBounds(e);return q.yMax-q.yMin<1e-6&&Math.abs(q.yMin-top)<1e-6;}),rimRadius));
 const low=top-rimRadius,high=baseY+supportLength+1;
 const zone=b.box(100,high-low,100,{at:[314.325,(low+high)/2,182.0333418],centered:true});
 const trim=b.unwrap(b.cut(zone,cap));
 shape=b.unwrap(b.cut(shape,trim));
 return normalize(shape);
}
