// Original, synthetic teaching robot. SI dimensions below also define its CAD;
// masses/materials/drive constants are estimates, not hardware measurements.
export const wheels = ['front-left','rear-left','front-right','rear-right'].map((id,i)=>({
  id,position:[i%2===0?.23:-.23,i<2?.30:-.30,.09],radius:.09,width:.05,mass:1,
}));
export const robotParts = [
 {id:'frame',body:'chassis',color:'#52687a',position:[0,0,.19],size:[.70,.54,.10]},
 {id:'bumper-front',body:'chassis',color:'#cf303d',position:[.38,0,.21],size:[.06,.68,.12]},
 {id:'bumper-back',body:'chassis',color:'#cf303d',position:[-.38,0,.21],size:[.06,.68,.12]},
 {id:'mast-left',body:'chassis',color:'#bbc7d1',position:[-.18,.18,.61],size:[.05,.05,.74]},
 {id:'mast-right',body:'chassis',color:'#bbc7d1',position:[-.18,-.18,.61],size:[.05,.05,.74]},
 {id:'lift-tray',body:'lift',color:'#ffc857',position:[.04,0,.36],size:[.30,.30,.06]},
 // Schematic mounting marker, not the manufacturer's mechanical CAD model.
 {id:'limelight-front-mount',body:'chassis',color:'#b6e032',position:[.29,0,.54],size:[.06,.08,.05]},
 ...wheels.map(w=>({...w,body:w.id,color:'#252832',kind:'wheel'})),
];
export const fieldParts = [
 {id:'floor',body:'floor',color:'#587365',position:[2,0,-.05],size:[8,4,.1]},
 {id:'left-wall',body:'left-wall',color:'#627b9a',position:[2,2,.15],size:[8,.08,.3]},
 {id:'right-wall',body:'right-wall',color:'#627b9a',position:[2,-2,.15],size:[8,.08,.3]},
 // This visual goal line has no collision; the season observer detects crossing.
 {id:'goal-line',color:'#f5d659',position:[2,0,.002],size:[.03,3.9,.004]},
 // Tag-plane markers correspond to the vision model's two surveyed poses.
 {id:'tag-1-plane',color:'#f4f4ef',position:[5,-.40,.7],size:[.002,.1651,.1651]},
 {id:'tag-2-plane',color:'#f4f4ef',position:[5,.40,.7],size:[.002,.1651,.1651]},
];
