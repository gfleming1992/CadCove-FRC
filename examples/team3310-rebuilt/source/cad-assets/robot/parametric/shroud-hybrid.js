import{getKernel,castShape}from'brepjs';
import body from'./shroud-lower-compact.js';
import rim from'./shroud-rim-compact.js';
export const parameters={mountHoleRadius:3.429};
// Original manufacturing planes and bores, with explicit curved rim and toe seam.
export default function build({mountHoleRadius=3.429,inspect=()=>{}}={}){
 if(!Number.isFinite(mountHoleRadius)||mountHoleRadius<=0||mountHoleRadius>=5.75625)throw Error('Mounting bore must fit inside the hex pocket');
 const lower=body({mountHoleRadius}),upper=rim();inspect({lower,upper});
 const k=getKernel(),faces=[lower,upper].flatMap(s=>k.iterShapes(s.wrapped,'face')).filter(f=>{const q=k.boundingBox(f);return !(Math.abs(q.min[2]-38.5)<1e-5&&Math.abs(q.max[2]-38.5)<1e-5)}),shell=k.sew(faces,.0001);try{const solid=k.solidFromShell(shell);try{return castShape(k.copyShape(solid))}finally{k.dispose(solid)}}finally{k.dispose(shell)}
}
