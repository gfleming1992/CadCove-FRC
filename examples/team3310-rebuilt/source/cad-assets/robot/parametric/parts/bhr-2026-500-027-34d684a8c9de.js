// Platform guard with editable base thickness and mounting-hole clearance.
import build,{parameters as defaults} from '../platform-guard.js';
export const parameters={...defaults};
export default function model(options={}){const {baseThickness,holeScale}={...parameters,...options};return build({baseThickness,holeScale});}
