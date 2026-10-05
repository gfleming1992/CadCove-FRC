import build from './bracket017m-split-trimmed.js';
export const parameters={counterboreDiameter:7.9375,rearPilotRadius:2.2479};
export default function model({counterboreDiameter=parameters.counterboreDiameter,rearPilotRadius=parameters.rearPilotRadius}={}){if(!(counterboreDiameter/2>rearPilotRadius&&rearPilotRadius>0))throw Error('Counterbore must exceed pilot radius');return build({counterboreDiameter,rearPilotRadius});}
