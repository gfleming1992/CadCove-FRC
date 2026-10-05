import {mirror,fuse,unwrap,getKernel,castShape} from 'brepjs';
import stock from './rear-corner-stock.js';
import {localBlendTool} from './rolling-blend.js';
import {analyticBlendTool} from './analytic-blend.js';
import step from './rear-step-blend-data.js';
import top from './rear-top-blend-data.js';
import bottom from './rear-bottom-blend-data.js';
// These local rolling patches preserve the manufactured transitions where
// the diagonal mounting pad and sloped outside clearance meet the L stock.
// The separate data modules contain surface fit samples; editing the bore
// or the identification depth does not require editing those samples.
export default function build(options={}) {
 const k=getKernel();let shape=stock(options);
 const side=localBlendTool(step,[1,1,-2],[-.001,-.0001,.0001]);
 const other=mirror(side,{normal:[1,-1,0],at:[0,0,0]});
 for(const patch of [side,other])shape=unwrap(fuse(shape,mirror(patch,{normal:[1,0,0],at:[0,0,0]})));
 const upper=localBlendTool(top,top.direction,top.offset);
 shape=castShape(k.cut(shape.wrapped,upper.wrapped));
 for(const [operation,direction,offset]of[['fuse',[2,2,0],[-.0001,-.0001,0]],['cut',[-2,-2,0],[.0001,.0001,0]]]){
  const tool=analyticBlendTool(bottom,direction,offset);shape=castShape(k[operation](shape.wrapped,tool.wrapped));
  if(!k.isValid(shape.wrapped)||k.volume(shape.wrapped)<124000||k.volume(shape.wrapped)>126000)throw Error('Invalid rear corner '+operation);
 }
 return shape;
}

// Shared rear stock and bore before handed identification is engraved.
export function buildBlank({holeScale=1}={}){return build({holeScale,engrave:false});}
