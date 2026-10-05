// Self-contained so the editor can bundle this trusted importer into a virtual
// model entry. STEP bytes and geometry execution stay in the CAD worker.
export function buildStepScene({occt, brepjs, adapter}, bytes, filename) {
  const doc = occt.importXCAFFromSTEP(new TextDecoder().decode(bytes));
  const identity = [1,0,0,0,0,1,0,0,0,0,1,0], parts = [];
  const srgb=rgb=>'#'+rgb.map(v=>Math.round(255*Math.max(0,Math.min(1,v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055))).toString(16).padStart(2,'0')).join('');
  function compose(a,b) {
    const out = new Array(12);
    for(let r=0;r<3;r++)for(let c=0;c<4;c++)
      out[r*4+c]=a[r*4]*b[c]+a[r*4+1]*b[4+c]+a[r*4+2]*b[8+c]+(c===3?a[r*4+3]:0);
    return out;
  }
  function walk(label, id, parent, inheritedColor, ancestors) {
    const prototype=doc.getReferredLabel(label), key=prototype??label;
    if(ancestors.has(key)||ancestors.size>128)throw Error('Cyclic or excessively nested STEP assembly');
    const occurrence=doc.getLabelInfo(label), info=prototype===null?occurrence:doc.getLabelInfo(prototype);
    try {
      const location=compose(parent,doc.getLocation(label));
      const color=occurrence.hasColor?occurrence.color:info.hasColor?info.color:inheritedColor;
      const children=doc.getChildren(key);
      if(children.length){
        const next=new Set(ancestors);next.add(key);
        children.forEach((child,i)=>walk(child,id+'/'+i,location,color,next));
      }else if(info.shapeHandle!==null){
        const placed=occt.located(info.shapeHandle,location);
        const shape=brepjs.castShape(adapter.downcast(placed,occt.getShapeType(placed).toLowerCase()));
        parts.push({id:'step:'+id,name:occurrence.name||info.name||filename,color:color?srgb(color):'#adb8c7',shape});
      }
    }finally{
      if(occurrence.shapeHandle!==null)occt.release(occurrence.shapeHandle);
      if(info!==occurrence&&info.shapeHandle!==null)occt.release(info.shapeHandle);
    }
  }
  try{
    doc.getRoots().forEach((label,i)=>walk(label,String(i),identity,null,new Set()));
    if(!parts.length)throw Error('STEP file contains no renderable shapes');
    return parts;
  }finally{doc.close();}
}
