import {buildDriveSpacer} from '../drive-spacer.js';
// Team drive-base spacer: preserve the hex fastener interfaces and adjoining
// frame clearance. Placement is the original prototype coordinate system.
export const parameters={length:146.05,notchWidth:101.6,nutAcrossFlats:9.5758};
export default function build(options={}){return buildDriveSpacer({...parameters,...options,center:[-301.625,-12.6873],angle:90});}
