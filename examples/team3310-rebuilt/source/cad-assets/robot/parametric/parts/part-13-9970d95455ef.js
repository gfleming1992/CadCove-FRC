import {buildDriveSpacer} from '../drive-spacer.js';
// Team drive-base spacer: preserve the hex fastener interfaces and adjoining
// frame clearance. Placement is the original prototype coordinate system.
export const parameters={length:158.75,notchWidth:88.9,nutAcrossFlats:9.5758};
export default function build(options={}){return buildDriveSpacer({...parameters,...options,center:[-193.675,101.6],angle:0});}
