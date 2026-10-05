// Backlash plate with radial cross-drill clearance and shaft-hub length controls.
import build from '../backlash-remover.js';
export const parameters={holeScale:1,hubLength:12.7};
export default function model(options={}){const {holeScale,hubLength}={...parameters,...options};return build({holeScale,hubLength});}
