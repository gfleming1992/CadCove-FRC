import*as b from'brepjs';import lower from'./rail600004b-lower-candidate.js';
export default function build(options={}){
 const s=lower(options),center=[-268.4195451227,-68.4183036],fillet=1.5875,major=14.2875;
 // Lower notch mouth is a quarter-torus lead-in, present only on the B rail.
 const tool=b.unwrap(b.cut(b.cylinder(major,fillet,{at:[...center,383.7432]}),b.torus(major,fillet,{at:[...center,385.3307]})));
 const limited=b.unwrap(b.intersect(tool,b.cylinder(149.225,1.5875,{at:[-162.5586951228,-173.4981036,383.7432]})));
 return b.unwrap(b.cut(s,limited));
}
