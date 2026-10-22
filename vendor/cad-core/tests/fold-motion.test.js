import {test,expect} from 'bun:test';
import {bendPoint,compileFoldMotion,FoldSurfaces} from '../src/core/fold-motion.js';
import {MechanismMotion} from '../src/core/mechanism-motion.js';
import {createCanvasCommands} from '../src/core/canvas-commands.js';
const bend={id:'bend',origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]],angleDeg:90,lengthMm:Math.PI/2*3.8,neutralOffsetMm:-.8};
const part={id:'strip',positions:new Float32Array([0,0,0,10,0,0,0,bend.lengthMm,0,10,bend.lengthMm,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2,1,3,2]),color:'#73b9df'};
const scene={parts:[part]};
const request=()=>({schema:1,sourceRevision:'rev',definition:{schema:1,units:'mm-deg-s',thicknessMm:2,bends:[structuredClone(bend)],zones:[{id:'strip',chain:['bend'],bend:'bend'}]},tracks:[{bend:'bend',startSeconds:0,seconds:4}],holdSeconds:1});
test('bend preserves neutral-axis length, thickness and tangent continuity',()=>{
 const L=bend.lengthMm;
 const surface=bendPoint([0,L,0],[0,0,1],bend,1,true);
 expect(surface.point[1]).toBeCloseTo(3,8);expect(surface.point[2]).toBeCloseTo(3,8);
 const outer=bendPoint([0,L,-2],[0,0,-1],bend,1,true);
 expect(Math.hypot(...outer.point.map((v,i)=>v-surface.point[i]))).toBeCloseTo(2,8);
 const wall=bendPoint([0,L,0],[0,0,1],bend,1,false);
 expect(wall.point).toEqual(surface.point);expect(wall.normal).toEqual(surface.normal);
 const tail=bendPoint([0,L+20,0],[0,0,1],bend,1,false);
 expect(tail.point[2]).toBeCloseTo(23,8);
 for(const fraction of [.01,.2,.5,1]){
  let sum=0,last;
  for(let i=0;i<=2000;i++){const p=bendPoint([0,L*i/2000,-.8],[0,0,1],bend,fraction,true).point;if(last)sum+=Math.hypot(...p.map((v,k)=>v-last[k]));last=p;}
  expect(sum).toBeCloseTo(L,5);
 }
});
test('fold refinement, seek, completion and reset reuse scene and preserve camera',()=>{
 let tick;globalThis.requestAnimationFrame=f=>(tick=f,1);globalThis.cancelAnimationFrame=()=>{};
 let changed,topology;const camera={distance:100,yaw:.7};
 const viewer={scene,draws:true,camera,clearMarkers(){},setTransforms(){},setDeformedTopology(v){topology=v;},setDeformedParts(v){changed=v;}};
 const motion=new MechanismMotion(viewer),command=createCanvasCommands({viewer,motion,selection:{},revision:()=> 'rev'});
 command('motion',{action:'play-fold',solution:request()});expect(motion.state().running).toBe(true);
 expect(topology.strip.positions.length).toBeGreaterThan(part.positions.length);
 command('motion',{action:'seek',seconds:4});const final=Array.from(changed.strip.positions);
 command('motion',{action:'seek',seconds:1});command('motion',{action:'seek',seconds:4});expect(Array.from(changed.strip.positions)).toEqual(final);
 command('motion',{action:'resume'});tick(performance.now()+6000);expect(motion.state().playback.status).toBe('completed');
 command('motion',{action:'reset'});expect(topology.strip).toBe(part);expect(viewer.scene).toBe(scene);expect(viewer.camera).toBe(camera);
 expect(command('motion',{action:'state'}).running).toBe(false);
});
test('fold rejects stale bindings, invalid frames and conflicting trees before replacing motion',()=>{
 for(const mutate of [v=>v.sourceRevision='old',v=>v.definition.bends[0].axes[0]=[2,0,0],v=>v.definition.zones[0].id='missing',v=>v.definition.zones[0].chain.push('bend'),v=>v.tracks[0].seconds=-1,v=>v.definition.bends[0].neutralOffsetMm=2]){
  const r=request();mutate(r);expect(()=>compileFoldMotion(r,scene,'rev')).toThrow();
 }
 const plan=compileFoldMotion(request(),scene,'rev'),surfaces=new FoldSurfaces(plan,scene);
 const positions=surfaces.evaluate(plan,0).deformations.strip.positions;
 expect(Array.from(positions)).toEqual(Array.from(surfaces.renderParts().strip.positions));
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test.skipIf(!process.env.CADCOVE_PYTHON||!process.env.CADCOVE_FREECAD||!process.env.CADCOVE_SHEETMETAL)('real unfolded sheet closes onto original OCCT solid, including nested and rotated bend frames',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-fold-proof-'));
 const run=async action=>{const p=Bun.spawn([process.env.CADCOVE_PYTHON,path.join(import.meta.dir,'fold-native.py'),action,root],{stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(code,out+'\n'+err).toBe(0);return JSON.parse(out);};
 try{
  await run('prepare');
  for(const name of ['base','nested','rotated']){
   const dir=path.join(root,name),definition=JSON.parse(await fs.readFile(path.join(dir,'fold-definition.json'))),scene=JSON.parse(await fs.readFile(path.join(dir,'mesh.json')));
   for(const p of scene.parts){p.positions=new Float32Array(p.positions);p.normals=new Float32Array(p.normals);p.indices=new Uint32Array(p.indices);}
   const plan=compileFoldMotion({schema:1,sourceRevision:'rev',definition,tracks:definition.bends.map((b,i)=>({bend:b.id,startSeconds:i*3,seconds:3}))},scene,'rev');
   if(name!=='base')expect(Math.max(...definition.zones.map(z=>z.chain.length))).toBe(2);
   const surfaces=new FoldSurfaces(plan,scene),shared=new Map();
   for(const [id,p]of Object.entries(surfaces.renderParts()))for(let i=0;i<p.positions.length;i+=3){const key=Array.from(p.positions.slice(i,i+3)).map(v=>v.toFixed(4)).join(',');if(!shared.has(key))shared.set(key,[]);shared.get(key).push([id,i]);}
   for(const t of [0,1,2.5,3,4,5.9,6]){
    const changes=surfaces.evaluate(plan,t).deformations;
    for(const nodes of shared.values())if(new Set(nodes.map(([id])=>id)).size>1){const [first,offset]=nodes[0],p=changes[first].positions.slice(offset,offset+3);for(const [id,i]of nodes)expect(Math.hypot(...p.map((v,k)=>v-changes[id].positions[i+k]))).toBeLessThan(.001);}
   }
   const end=surfaces.evaluate(plan,plan.duration).deformations,points=[];
   for(const p of Object.values(end))for(let i=0;i<p.positions.length;i+=3)points.push(Array.from(p.positions.slice(i,i+3)));
   await fs.writeFile(path.join(dir,'evaluated.json'),JSON.stringify(points));
  }
  const result=await run('verify');expect(result.maximumDistanceMm).toBeLessThan(.001);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);

test('switching to a different scene discards old fold topology before reset',()=>{
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const viewer={scene,draws:true,clearMarkers(){},setTransforms(){},setDeformedParts(){},setDeformedTopology(v){if(viewer.scene!==scene)throw Error('Stale fold topology');}};
 const motion=new MechanismMotion(viewer);motion.playFold(request(),'rev');
 viewer.scene={parts:[{id:'new'}]};const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 motion.playSolved({schema:1,units:'mm-deg-s',sourceRevision:'new-rev',bodies:[{id:'new',parts:['new'],pose:I}],frames:[{time:0,poses:[I]},{time:1,poses:[I]}]},'new-rev');
 motion.reset();expect(motion.folds).toBe(null);
});
