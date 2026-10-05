import {getKernel,castShape} from 'brepjs';
import buildStock from './bracket017-profile-parametric.js';
import {localBlendTool} from './build-local-blend.js';
import rear from './bracket017-rear-blend-data.js';
import front from './bracket017-front-blend-data.js';
export const parameters={frontMountHoleRadius:1.7272};
// Experimental; whole-part fidelity gate has NOT passed.
export default function build(options={}) {
 const k=getKernel(),stock=buildStock(options);
 // Micrometre offsets avoid coincident trim boundaries in the Boolean. They
 // remain covered by the independent 0.005 mm surface fidelity requirement.
 const rearTool=localBlendTool(rear,[-2,.2,-.2],[.001,-.0001,.0001]);
 const rearBlended=castShape(k.fuse(stock.wrapped,rearTool.wrapped));
 const frontTool=localBlendTool(front,[0,2,2],[0,-.001,-.001]);
 const result=castShape(k.cut(rearBlended.wrapped,frontTool.wrapped));
 if(!k.isValid(result.wrapped)||k.volume(result.wrapped)<28000)
   throw Error('Bracket blend lost valid stock');
 return result;
}
