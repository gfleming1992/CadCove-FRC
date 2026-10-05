import {buildDriveSpacer} from '../drive-spacer.js';
// Team drive-base spacer: preserve the hex fastener interfaces and adjoining
// frame clearance. Placement is the original prototype coordinate system.
export const parameters={length:95.25,notchWidth:50.8,nutAcrossFlats:9.5758};
export default function build(options={}){return buildDriveSpacer({...parameters,...options,center:[-88.9,0],angle:90});}
