import build from '../rear-corner.js';
// Rear drive-base mounting corner; dimensions in millimetres.
export const parameters={holeScale:1,engravingDepth:1.5875};
export default function model(options={}){return build({...parameters,...options});}
