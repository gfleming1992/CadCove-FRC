// 35-degree equipment mount: editable screw clearance and window length.
import build,{parameters as defaults} from '../mount2025.js';
export const parameters={...defaults};
export default function model(options={}){return build({...parameters,...options});}
