import catalog from './catalog.js';
import instances from './instances.js';
export default async function build({readAsset,occt,brepjs,adapter}) {
 const prototypes=new Map(),parts=[];
 function wrap(h){return brepjs.castShape(adapter.downcast(h,occt.getShapeType(h).toLowerCase()));}
 for(const node of instances){
  const asset=catalog[node.asset];let shape=prototypes.get(node.asset);
  if(!shape){shape=wrap(occt.importStep(new TextDecoder().decode(await readAsset(asset.file,asset.sha256))));prototypes.set(node.asset,shape);}
  parts.push({id:node.id,name:node.name,color:node.color,shape:wrap(occt.located(shape.wrapped.id,node.transform))});
 }
 return parts;
}
