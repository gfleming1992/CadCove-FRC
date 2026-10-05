import{mirror,cut,cylinder,unwrap}from'brepjs';
import buildBracket from'./bracket017-split-trimmed.js';
export const parameters={frontMountHoleRadius:1.7272,counterboreDiameter:7.9375,rearPilotRadius:2.2479};
// Opposite-hand mounting bracket keeps the common body and rear fastener access.
// Draft pending complete nominal surface and functional acceptance.
export default function build({frontMountHoleRadius=parameters.frontMountHoleRadius,counterboreDiameter=parameters.counterboreDiameter,rearPilotRadius=parameters.rearPilotRadius}={}){
 if(![frontMountHoleRadius,counterboreDiameter,rearPilotRadius].every(x=>Number.isFinite(x)&&x>0))throw Error('Invalid bore dimension');
 let shape=mirror(buildBracket({frontMountHoleRadius}),{normal:[0,1,0],at:[0,-173.4981036,0]});
 shape=unwrap(cut(shape,cylinder(counterboreDiameter/2,28.68504173654003,{at:[-319.913,-100.4731036,399.6182],axis:[0,-1,0]})));
 return unwrap(cut(shape,cylinder(rearPilotRadius,15.637958263456,{at:[-319.913,-144.7961036,399.6182],axis:[0,1,0]})));
}
