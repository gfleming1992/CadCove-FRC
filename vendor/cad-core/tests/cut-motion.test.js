import {test,expect} from 'bun:test';
import {validateCutRequest,compileCutMotion,CutSurfaces} from '../src/core/cut-motion.js';
import {MechanismMotion} from '../src/core/mechanism-motion.js';
import {createCanvasCommands} from '../src/core/canvas-commands.js';
export const request=()=>({schema:1,sourceRevision:'rev',units:'mm-s',stock:{id:'stock',origin:[0,0,0],size:[20,12,3]},tool:{id:'tool',kind:'bit',diameterMm:2,lengthMm:8},resolutionMm:.5,start:[3,3,5],moves:[{mode:'cut',to:[3,3,1],seconds:1},{mode:'cut',to:[17,3,1],seconds:3},{mode:'rapid',to:[17,3,5],seconds:1},{mode:'rapid',to:[3,8,5],seconds:1},{mode:'cut',to:[3,8,-1],seconds:1},{mode:'cut',to:[17,8,-1],seconds:3}]});
export function fixture(){
 const vertices=[[0,0,0],[20,0,0],[20,12,0],[0,12,0],[0,0,3],[20,0,3],[20,12,3],[0,12,3]];
 const stock={id:'stock',color:'#b9c5d0',positions:new Float32Array(vertices.flat()),normals:new Float32Array(vertices.map(()=>[0,0,1]).flat()),indices:new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7])};
 return {parts:[stock,{...stock,id:'tool',color:'#f19e38'}]};
}
const at=(s,x,y)=>s.heights[Math.floor(y/s.plan.dy)*s.plan.nx+Math.floor(x/s.plan.dx)];
test('stock removal preserves pockets, finished islands, scrap and rapid moves',()=>{
 const scene=fixture(),plan=compileCutMotion(request(),scene,'rev'),s=new CutSurfaces(plan,scene);
 s.evaluate(plan,4);expect(at(s,8,3)).toBeCloseTo(1);expect(at(s,8,8)).toBe(3);
 s.evaluate(plan,6);expect(at(s,10,5)).toBe(3);
 s.evaluate(plan,10);expect(at(s,8,8)).toBe(0);expect(at(s,8,5)).toBe(3);expect(at(s,0,0)).toBe(3);
 const i=Math.floor(8/plan.dy)*plan.nx+Math.floor(8/plan.dx);const v=s.positions.slice(i*72,i*72+72);for(let k=3;k<v.length;k++)expect(v[k]).toBe(v[k%3]);
 const final=Array.from(s.positions);s.evaluate(plan,1);for(let t=1.13;t<10;t+=.13)s.evaluate(plan,t);s.evaluate(plan,10);
 expect(Array.from(s.positions)).toEqual(final);
 const loop=request();loop.start=[5,4,0];loop.moves=[[15,4,0],[15,9,0],[5,9,0],[5,4,0]].map(to=>({mode:'cut',to,seconds:1}));
 const q=compileCutMotion(loop,scene,'rev'),b=new CutSurfaces(q,scene);b.evaluate(q,4);expect(at(b,10,6)).toBe(3);expect(at(b,1,1)).toBe(3);expect(at(b,5,6)).toBe(0);
});
test('laser kerf, angled depth ramps, backwards seek, stale and oversized inputs',()=>{
 const decimal=request();decimal.tool.diameterMm=.6;decimal.resolutionMm=.2;expect(validateCutRequest(decimal).nx).toBe(100);
 const alias=request();alias.tool.kind='router';expect(compileCutMotion(alias,fixture(),'rev').tool.kind).toBe('router');
 const r=request();r.tool.kind='laser';r.start=[3,3,0];r.moves=[{mode:'cut',to:[17,3,0],seconds:2}];const p=compileCutMotion(r,fixture(),'rev'),s=new CutSurfaces(p,fixture());s.evaluate(p,2);expect(at(s,10,3)).toBe(0);expect(at(s,10,5)).toBe(3);s.evaluate(p,0);expect(at(s,10,3)).toBe(3);
 for(const mutate of [p=>p.sourceRevision='stale',p=>p.stock.size[0]=19,p=>p.resolutionMm=.0001,p=>p.resolutionMm=2,p=>p.moves[0].seconds=NaN,p=>p.tool.id='stock']){const v=request();mutate(v);expect(()=>compileCutMotion(v,fixture(),'rev')).toThrow();}
 r.moves[0].to[2]=1;expect(()=>validateCutRequest(r)).toThrow('Laser');
 const ramp=request();ramp.start=[3,3,3];ramp.moves=[{mode:'cut',to:[17,3,0],seconds:4}];const q=compileCutMotion(ramp,fixture(),'rev'),a=new CutSurfaces(q,fixture());a.evaluate(q,4);expect(at(a,6,3)).toBeGreaterThan(at(a,14,3));
});
test('cut uses shared playback, preserves source/camera, resets and rejects before replacing playback',()=>{
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const scene=fixture(),camera={distance:50};let topology,transforms;
 const viewer={scene,camera,draws:true,clearMarkers(){},setTransforms(t){transforms=t;},setDeformedTopology(t){topology=t;},setDeformedParts(){}};
 const motion=new MechanismMotion(viewer),api=createCanvasCommands({viewer,motion,selection:{},revision:()=> 'rev'});
 api('motion',{action:'play-cut',solution:request()});expect(api('motion',{action:'state'}).playback.kind).toBe('cut');
 api('motion',{action:'seek',seconds:10});expect(transforms.tool[3]).toBe(17);expect(transforms.tool[11]).toBe(-1);
 const previous=motion.playback;expect(()=>api('motion',{action:'play-cut',solution:{...request(),sourceRevision:'bad'}})).toThrow();expect(motion.playback).toBe(previous);
 api('motion',{action:'reset'});expect(topology.stock).toBe(scene.parts[0]);expect(viewer.camera).toBe(camera);expect(viewer.scene).toBe(scene);
});

 test('laser nozzle follows the head, beam ends on the surface and is off during travel and reset',()=>{
 const scene=fixture();scene.parts.push({...scene.parts[1],id:'nozzle'});
 const r=request();r.tool.kind='laser';r.tool.nozzleId='nozzle';r.start=[3,3,0];r.moves=[{mode:'cut',to:[17,3,0],seconds:2},{mode:'rapid',to:[17,9,0],seconds:2}];
 const p=compileCutMotion(r,scene,'rev'),s=new CutSurfaces(p,scene),cut=s.evaluate(p,1);
 expect(cut.transforms.nozzle).toEqual(cut.transforms.tool);expect(cut.opacity.tool).toBe(1);
 const zs=Array.from(cut.deformations.tool.positions).filter((_,i)=>i%3===2);expect(Math.min(...zs)).toBe(3);expect(Math.max(...zs)).toBe(8);
 expect(s.evaluate(p,3).opacity.tool).toBe(0);expect(s.evaluate(p,4).opacity.tool).toBe(0);expect(s.resetOpacity().tool).toBe(0);
 r.tool.lengthMm=2;expect(()=>compileCutMotion(r,scene,'rev')).toThrow('above');
 });

 test('thin kerf tangent cells are identical across frame subdivision and direct seek',()=>{
 const r=request();r.tool.kind='laser';r.tool.diameterMm=.6;r.resolutionMm=.2;r.start=[3,3,0];r.moves=[{mode:'rapid',to:[3,3,0],seconds:2},{mode:'cut',to:[17,3,0],seconds:5}];
 const scene=fixture(),p=compileCutMotion(r,scene,'rev'),s=new CutSurfaces(p,scene);
 for(let t=0;t<7;t+=.1)s.evaluate(p,t);s.evaluate(p,7);const sampled=Array.from(s.heights);
 s.evaluate(p,0);s.evaluate(p,7);expect(Array.from(s.heights)).toEqual(sampled);
 });

test('circular cut walls follow the cutter instead of square grid steps',()=>{
 const r=request();r.start=[10,6,0];r.tool.diameterMm=4;r.moves=[{mode:'cut',to:[10,6,0],seconds:1}];
 const scene=fixture(),p=compileCutMotion(r,scene,'rev'),s=new CutSurfaces(p,scene);s.evaluate(p,1);
 let walls=0,maxError=0;
 for(let i=0;i<s.positions.length;i+=72)for(let side=0;side<4;side++){
  const k=i+24+side*12,a=Array.from(s.positions.slice(k,k+3)),b=Array.from(s.positions.slice(k+9,k+12));
  if(a[2]!==3||s.positions[k+5]!==0||Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8)continue;
  if(a[0]<1||a[0]>19||a[1]<1||a[1]>11)continue;
  for(const v of [a,b])maxError=Math.max(maxError,Math.abs(Math.hypot(v[0]-10,v[1]-6)-2));walls++;
 }
 expect(walls).toBeGreaterThan(20);expect(maxError).toBeLessThan(.07);
 const end=Array.from(s.positions);s.evaluate(p,0);for(let t=.1;t<1;t+=.1)s.evaluate(p,t);s.evaluate(p,1);expect(Array.from(s.positions)).toEqual(end);
 // Pockets retain their exact depth while sharing the same smooth contour.
 r.moves=[{mode:'cut',to:[10,6,1],seconds:1}];r.start=[10,6,1];const pp=compileCutMotion(r,scene,'rev'),pocket=new CutSurfaces(pp,scene);pocket.evaluate(pp,1);
 expect(at(pocket,10,6)).toBe(1);expect(at(pocket,1,1)).toBe(3);
});
