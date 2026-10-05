import catalog from './catalog.js';
import instances from './instances.js';
import builders from './parametric/registry.js';

// These reference imports need OCCT tolerance repair at particular rotations.
// Their source files remain unchanged; every repair is guarded by mass checks.
const repairableImports={"4-stealth-wheel-40a-1-2-hex-bore-997621bd055b":"997621bd055b88cf3b0de7136d3b9f52ce85fc16b6a159e158a81b996a9915b1"};

// Author team parts in parametric/parts. The registry includes only replacements
// validated against the reference STEP. Vendor and pending custom parts retain
// their original imports. Occurrence IDs, colors, and placements stay stable.
export default async function build({readAsset, occt, brepjs, adapter}) {
  const prototypes = new Map(), parts = [];
  const wrap = handle => brepjs.castShape(adapter.downcast(handle, occt.getShapeType(handle).toLowerCase()));
  for (const node of instances) {
    let shape = prototypes.get(node.asset);
    if (!shape) {
      const asset = catalog[node.asset];
      shape = builders[node.asset]
        ? builders[node.asset]()
        : wrap(occt.importStep(new TextDecoder().decode(await readAsset(asset.file, asset.sha256))));
      prototypes.set(node.asset, shape);
    }
    let placed=occt.located(shape.wrapped.id, node.transform);
    if(repairableImports[node.asset]&&!occt.isValid(placed)){
      if(catalog[node.asset].sha256!==repairableImports[node.asset])throw Error('Changed vendor import requires placement validation: '+node.asset);
      const metrics=h=>({volume:occt.getVolume(h),area:occt.getSurfaceArea(h),center:Object.values(occt.getCenterOfMass(h)),inertia:occt.getInertia(h)});
      const before=metrics(placed),fixed=occt.fixShape(placed),after=metrics(fixed);
      const relative=(a,b)=>Math.abs(a-b)/Math.max(1,Math.abs(a));
      if(!occt.isValid(fixed)||relative(before.volume,after.volume)>1e-9||relative(before.area,after.area)>1e-9||
         Math.hypot(...before.center.map((v,i)=>v-after.center[i]))>1e-6||
         Math.hypot(...before.inertia.map((v,i)=>v-after.inertia[i]))/Math.hypot(...before.inertia)>1e-9)
        throw Error('Placement repair changed geometry: '+node.id);
      if(fixed!==placed)occt.release(placed);placed=fixed;
    }
    parts.push({id:node.id, name:node.name, color:node.color,shape:wrap(placed)});
  }
  return parts;
}
