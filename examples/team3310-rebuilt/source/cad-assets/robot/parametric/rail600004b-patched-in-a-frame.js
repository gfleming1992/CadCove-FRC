import{getKernel,castShape}from'brepjs';
import base from'./rail600004b-stock-in-a-frame.js';
import data from'./rail600004-region-data.js';
// The three small rolling-blend junctions retain their measured trim profiles.
// Cylinders and tori remain analytic; only six freeform corner patches use grids.
export default function build(options={}){
 const k=getKernel(),owned=[],own=x=>(owned.push(x),x);let s=base(options);
 try{
  for(let[ri,region]of data.entries()){
   const[x0,x1,y0,y1,z0,z1]=region.box;
   const box=own(k.translate(own(k.makeBox(x1-x0,y1-y0,z1-z0)),x0,y0,z0));
   const cut=own(k.cut(s.wrapped,box));
   const remaining=k.iterShapes(cut,'face').filter(f=>{
    if(k.surfaceType(f).toLowerCase()!=='plane')return true;
    let q=k.surfaceCenterOfMass(f);
    return ![q[0]-x0,q[0]-x1,q[1]-y0,q[1]-y1,q[2]-z0,q[2]-z1].some(d=>Math.abs(d)<1e-6);
   });
   let newFaces=[];
   for(let d of region.faces){
    const origin=d.sample,local=p=>p.map((v,i)=>(v-origin[i])*1000);
    let support;
    if(d.type==='bspline')support=own(k.translate(own(k.scale(own(k.bsplineSurface(d.grid.map(local),d.n,d.n)),[0,0,0],.001)),...origin));
    else if(d.analytic){
     const a=d.analytic,solid=own(k.generalTransform(own(d.type==='cylinder'?k.makeCylinder(a.major,100):k.makeTorus(a.major,a.minor)),a.linear,a.origin,true));
     support=k.iterShapes(solid,'face').find(f=>k.surfaceType(f).toLowerCase()===d.type);
     if(!support)throw Error('Missing analytic blend support');
    }
    const wires=d.wires.map(w=>({outer:w.outer,wire:own(k.makeWire(w.edges.filter(e=>Math.hypot(...e.points[0].map((x,j)=>x-e.points.at(-1)[j]))>1e-8).map(e=>{
     let edge=e.type==='line'?own(k.makeLineEdge(...e.points)):own(k.translate(own(k.scale(own(k.interpolatePoints(e.points.map(local),{periodic:false,tolerance:1e-7})),[0,0,0],.001)),...origin));
     return e.reverse?own(k.reverseShape(edge)):edge;
    })))}));
    const wire=wires.find(w=>w.outer).wire,choices=[];
    for(let reverse of[false,true])try{
     const w=reverse?own(k.reverseShape(wire)):wire;
     let f=own(k.healFace(own(d.type==='plane'?k.makeFace(w,true):k.makeFaceOnSurface(support,w))));
     if(k.isValid(f)&&k.area(f)>0)choices.push({f,error:Math.abs(k.area(f)-d.area)});
    }catch{}
    const choice=choices.sort((a,b)=>a.error-b.error)[0];
    if(!choice||choice.error>.001)throw Error('Failed blend face '+ri+'/'+d.fi+' '+JSON.stringify(choices));
    let f=choice.f,uv=k.uvFromPoint(f,d.sample),normal=k.surfaceNormal(f,uv[0],uv[1]);
    if(normal.reduce((sum,x,i)=>sum+x*d.normal[i],0)<0)f=own(k.reverseShape(f));
    newFaces.push(f);
   }
   let shell=own(k.sew([...remaining,...newFaces],1e-5)),solid=own(k.solidFromShell(shell));
   if(k.volume(solid)<0)solid=own(k.reverseShape(solid));
   options.report?.({ri,valid:k.isValid(solid),volume:k.volume(solid),remaining:remaining.length,added:newFaces.length});
   if(!k.isValid(solid))throw Error('Invalid patched rail '+ri);
   s=castShape(k.copyShape(solid));
  }
  return s;
 }finally{for(let h of owned.reverse())k.dispose(h);}
}
