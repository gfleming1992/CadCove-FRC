import build from '../backlash-right.js';
export const parameters={holeScale:1,hubLength:25.4};
export default function model(options={}){return build({...parameters,...options});}
