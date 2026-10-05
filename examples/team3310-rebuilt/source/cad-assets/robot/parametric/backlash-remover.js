import{getKernel,castShape}from'brepjs';
import build from'./backlash-trimmed.js';
// Normalize the newly generated shape's inconsistent pcurves through OCCT's
// exchange repair path. No original STEP data or file is read by this model.
export default function model(options={}){
 const generated=build(options),k=getKernel();
 try{
  const shapes=k.importSTEP(k.exportSTEP([generated.wrapped]));
  if(shapes.length!==1)throw Error('Expected one normalized backlash part');
  return castShape(shapes[0]);
 }finally{k.dispose(generated.wrapped);}
}
