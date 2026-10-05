import build from '../shroud-hybrid.js';
export const parameters={mountHoleRadius:3.429};
export default function model(options={}){return build({...parameters,...options});}
