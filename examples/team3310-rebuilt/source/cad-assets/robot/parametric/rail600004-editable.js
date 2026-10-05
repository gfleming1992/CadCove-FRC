import buildRail from './rail600004-patched.js';
// Mounting clearance and anti-rotation nut pockets are independently editable.
export const parameters={holeScale:1,nutAcrossFlats:9.779};
export default function build(options={}){return buildRail({...parameters,...options});}
