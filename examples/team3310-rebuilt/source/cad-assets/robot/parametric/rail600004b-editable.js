import buildRail from './rail600004b.js';
export const parameters={holeScale:1,nutAcrossFlats:9.779};
export default function build(options={}){return buildRail({...parameters,...options});}
