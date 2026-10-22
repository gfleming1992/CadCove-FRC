import {test,expect} from 'bun:test';
import {compileSolvedMotion,evaluateSolvedMotion} from '../src/core/solved-motion.js';
import {MechanismMotion} from '../src/core/mechanism-motion.js';
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const pose=x=>I.map((v,i)=>i===12?x:v);
const result=()=>({schema:1,units:'mm-deg-s',sourceRevision:'rev',bodies:[{id:'a',pose:pose(10),parts:['part']}],frames:[{time:0,poses:[pose(10)]},{time:1,poses:[pose(20)]}]});
test('solved poses use bind-relative transforms and hold exact samples',()=>{
 const plan=compileSolvedMotion(result(),['part','context'],'rev');
 expect(evaluateSolvedMotion(plan,.5).transforms.part[3]).toBe(0);
 expect(evaluateSolvedMotion(plan,1).transforms.part[3]).toBe(10);
 expect(evaluateSolvedMotion(plan,1).transforms.context[3]).toBe(0);
 expect(()=>compileSolvedMotion(result(),['part'],'new-revision')).toThrow('stale');
 const bad=result();bad.frames[1].poses[0][0]=2;
 expect(()=>compileSolvedMotion(bad,['part'],'rev')).toThrow('rigid');
});
test('solver playback uses local clock, seek and reset without building geometry',()=>{
 let tick;globalThis.requestAnimationFrame=f=>{tick=f;return 1;};globalThis.cancelAnimationFrame=()=>{};
 const changes=[];const viewer={scene:{parts:[{id:'part'}]},draws:true,clearMarkers(){},setTransforms(t){changes.push(t);}};
 const motion=new MechanismMotion(viewer);
 expect(motion.playSolved(result(),'rev').running).toBe(true);
 motion.seek(1);expect(changes.at(-1).part[3]).toBe(10);
 motion.resume();tick(performance.now()+2000);expect(motion.state().playback.status).toBe('completed');
 motion.reset();expect(changes.at(-1).part[3]).toBe(0);
});

// Native round-trip/browser coverage supplies real solver output. These tests
// exercise rejection before playback mutates the scene or replaces a live plan.
import {fixture} from './belt-motion.test.js';
function beltFixture(){
 const {model,mesh}=fixture();
 const bodies=[{id:'carrier',pose:I,parts:['belt']},{id:'pulley',pose:I,parts:['p0']},{id:'follower',pose:pose(50),parts:['p1']}];
 const solution={schema:1,units:'mm-deg-s',sourceRevision:'rev',bodies,
  mates:[{id:'drive',type:'revolute',a:{body:'carrier'},b:{body:'pulley'}}],jointBindings:[{joint:'j0',mate:'drive'}],
  frames:[{time:0,poses:bodies.map(b=>b.pose),angles:{j0:0}},{time:1,poses:bodies.map(b=>b.pose),angles:{j0:720}}]};
 return {model,mesh,solution};
}
test('solved belts require complete continuous coordinates and correct occurrence ownership',()=>{
 const {model,solution}=beltFixture(),ids=['belt','p0','p1'];
 const plan=compileSolvedMotion(solution,ids,'rev',model);
 expect(evaluateSolvedMotion(plan,1).angles.j0).toBe(720);
 for(const mutate of [s=>s.jointBindings=[],s=>delete s.frames[1].angles.j0,s=>s.frames[1].angles.j0=NaN,s=>s.jointBindings[0].joint='unknown',s=>s.mates[0].b.body='follower',s=>s.jointBindings.push(s.jointBindings[0])]){
  const bad=structuredClone(solution);mutate(bad);expect(()=>compileSolvedMotion(bad,ids,'rev',model)).toThrow();
 }
});
test('bad solved belt command preserves current playback and a new scene drops stale belts',()=>{
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const {model,mesh,solution}=beltFixture();let changes=0;
 const viewer={scene:{parts:[mesh,{id:'p0'},{id:'p1'}]},draws:true,clearMarkers(){},setTransforms(){changes++;},setDeformedParts(){},setDeformedTopology(){}};
 const motion=new MechanismMotion(viewer).load(model);motion.playSolved(solution,'rev');
 const plan=motion.playback,count=changes,bad=structuredClone(solution);delete bad.frames[1].angles;
 expect(()=>motion.playSolved(bad,'rev')).toThrow();expect(motion.playback).toBe(plan);expect(changes).toBe(count);
 viewer.scene={parts:[{id:'part'}]};motion.playSolved(result(),'rev');
 expect(motion.belts).toBe(null);expect(motion.model).toBe(null);motion.reset();
});
