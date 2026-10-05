import {getEdges,getBounds,fillet,fuse,simplify,cut,compound,cylinder,unwrap} from 'brepjs';
import {buildPrismaticPart} from '../profile.js';

// Matching foot for the Part57 channel. The two bores preserve its screw
// centers. Rear scallops clear neighbouring fasteners; the raised pad supports
// the upright. Profiles retain analytic lines/arcs recovered from the reference.
// These are recovered manufacturing contours, not original sketch constraints.
export const parameters={holeScale:1,padRise:3.175};
export const baseProfile={"origin":[0,0,92.075],"normal":[0,0,1],"u":[1,0,0],"v":[0,1,0],"direction":[0,0,1],"depth":6.35,"outline":[{"kind":"line","from":[-295.7035249405,-154.4481036],"to":[-274.05,-154.4481036]},{"kind":"arc","from":[-274.05,-154.4481036],"mid":[-273.3428932188,-154.7409968188],"to":[-273.05,-155.4481036]},{"kind":"line","from":[-273.05,-191.5481036],"to":[-273.05,-155.4481036]},{"kind":"arc","from":[-274.05,-192.5481036],"mid":[-273.3428932188,-192.2552103812],"to":[-273.05,-191.5481036]},{"kind":"line","from":[-303.8,-192.5481036],"to":[-274.05,-192.5481036]},{"kind":"arc","from":[-303.8,-192.5481036],"mid":[-304.5071067812,-192.2552103812],"to":[-304.8,-191.5481036]},{"kind":"line","from":[-304.8,-191.5481036],"to":[-304.8,-184.0899842446]},{"kind":"arc","from":[-303.4736292428,-183.1447424084],"mid":[-304.3803573222,-183.2756222989],"to":[-304.8,-184.0899842446]},{"kind":"arc","from":[-303.4736292428,-183.1447424085],"mid":[-295.9608,-177.7907036],"to":[-303.4736292428,-172.4366647915]},{"kind":"arc","from":[-304.8,-171.4914229553],"mid":[-304.3803573222,-172.305784901],"to":[-303.4736292428,-172.4366647915]},{"kind":"line","from":[-304.8,-171.4914229553],"to":[-304.8,-158.6899842446]},{"kind":"arc","from":[-303.4736292428,-157.7447424084],"mid":[-304.3803573222,-157.8756222989],"to":[-304.8,-158.6899842446]},{"kind":"arc","from":[-303.4736292428,-157.7447424085],"mid":[-299.5195267082,-157.6490440091],"to":[-296.5920749629,-154.9893238514]},{"kind":"arc","from":[-295.7035249405,-154.4481036],"mid":[-296.2237269453,-154.5940603492],"to":[-296.5920749629,-154.9893238515]}],"cutouts":[]};
export const padProfile={"origin":[0,0,98.425],"normal":[0,0,1],"u":[1,0,0],"v":[0,1,0],"direction":[0,0,1],"depth":3.175,"outline":[{"kind":"line","from":[-295.7035249405,-154.4481036],"to":[-276.225,-154.4481036]},{"kind":"line","from":[-276.225,-154.4481036],"to":[-276.225,-179.0430783004]},{"kind":"arc","from":[-279.052653754,-184.3265976694],"mid":[-276.9763662978,-182.0393761275],"to":[-276.225,-179.0430783004]},{"kind":"line","from":[-288.5776537539,-190.6765976694],"to":[-279.0526537539,-184.3265976694]},{"kind":"arc","from":[-298.45,-185.3930783004],"mid":[-295.0962978271,-190.9917120026],"to":[-288.5776537539,-190.6765976694]},{"kind":"line","from":[-298.45,-185.1129557562],"to":[-298.45,-185.3930783004]},{"kind":"arc","from":[-297.1343551797,-181.2428436229],"mid":[-298.1120984436,-183.0691425787],"to":[-298.45,-185.1129557562]},{"kind":"arc","from":[-297.1343551797,-181.2428436229],"mid":[-295.9608,-177.7907036],"to":[-297.1343551797,-174.338563577]},{"kind":"arc","from":[-298.45,-170.4684514437],"mid":[-298.1120984436,-172.5122646212],"to":[-297.1343551797,-174.338563577]},{"kind":"line","from":[-298.45,-159.7129557562],"to":[-298.45,-170.4684514437]},{"kind":"arc","from":[-297.1343551797,-155.8428436229],"mid":[-298.1120984436,-157.6691425787],"to":[-298.45,-159.7129557562]},{"kind":"arc","from":[-297.1343551797,-155.8428436229],"mid":[-296.8441298169,-155.4282094737],"to":[-296.5920749629,-154.9893238514]},{"kind":"arc","from":[-295.7035249405,-154.4481036],"mid":[-296.2237269453,-154.5940603492],"to":[-296.5920749629,-154.9893238515]}],"cutouts":[]};
const edgeRound=.5,baseTop=98.425;
const horizontal=shape=>getEdges(shape).filter(e=>{const q=getBounds(e);return Math.abs(q.zMax-q.zMin)<1e-5;});
export default function build({holeScale=parameters.holeScale,padRise=parameters.padRise}={}){
 if(!Number.isFinite(holeScale)||holeScale<=0||!Number.isFinite(padRise)||padRise<=edgeRound)throw Error('Positive screw scale and pad rise greater than edge round required');
 let lower=buildPrismaticPart(baseProfile);
 lower=unwrap(fillet(lower,horizontal(lower),edgeRound));
 // Overlap the pad into the base by the edge-round radius. Rounding the base
 // before union preserves its external lip while leaving the internal step
 // sharp, including where the pad terminates tangentially at each scallop.
 let upper=buildPrismaticPart({...padProfile,origin:[0,0,baseTop-edgeRound],depth:padRise+edgeRound});
 upper=unwrap(fillet(upper,horizontal(upper).filter(e=>Math.abs(getBounds(e).zMin-baseTop-padRise)<1e-5),edgeRound));
 let shape=unwrap(simplify(unwrap(fuse(lower,upper))));
 const holes=[-183.0231036,-163.9731036].map(y=>cylinder(2.2479*holeScale,baseProfile.depth+padRise+.00002,{at:[-285.75,y,baseProfile.origin[2]-.00001]}));
 return unwrap(cut(shape,compound(holes)));
}
