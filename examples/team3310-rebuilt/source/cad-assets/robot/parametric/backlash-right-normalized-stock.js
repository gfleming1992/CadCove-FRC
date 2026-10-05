import{getKernel,castShape}from'brepjs';import stock from './backlash-right-stock-candidate.js';
export default function build(options={}){const shape=stock(options),k=getKernel();try{const results=k.importSTEP(k.exportSTEP([shape.wrapped]));if(results.length!==1)throw Error('Expected one normalized stock shape');return castShape(results[0]);}finally{k.dispose(shape.wrapped);}}
