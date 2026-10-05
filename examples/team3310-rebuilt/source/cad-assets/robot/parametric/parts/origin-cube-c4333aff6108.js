import {box} from 'brepjs';
// Assembly datum: the robot origin lies at the center of the cube's top face.
// This is a reference marker, not manufactured robot stock or vendor hardware.
export const parameters={size:25.4};
export default function build({size=parameters.size}={}){
 if(!Number.isFinite(size)||size<=0)throw Error('Datum cube size must be positive');
 return box(size,size,size,{at:[0,0,-size/2],centered:true});
}
