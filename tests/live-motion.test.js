import {test,expect} from 'bun:test';
import {LiveMotion,interpolatePose} from '../web/live-motion.js';
const state=(tick)=>({tick,bodies:{}});
test('render between received poses and never predict beyond newest physics',()=>{
 const m=new LiveMotion();m.push('a',state(1),100);m.push('a',state(2),140);
 expect(m.sample(170).alpha).toBe(.5);expect(m.sample(300).b.tick).toBe(2);expect(m.sample(300).alpha).toBe(1);
});
test('resets, stale packets and long interruptions cannot blend unrelated poses',()=>{
 const m=new LiveMotion();m.push('a',state(100),0);m.push('a',state(99),1);expect(m.frames.length).toBe(1);
 m.push('b',state(1),10);expect(m.frames.length).toBe(1);expect(m.sample(10).b.tick).toBe(1);
 m.push('b',state(2),1000);expect(m.frames.length).toBe(1);expect(m.sample(1000).a.tick).toBe(2);
});
test('quaternions use the short arc, remain normalized and do not mutate snapshots',()=>{
 const a={position:[0,0,0],quaternion:[0,0,0,1]},b={position:[2,4,6],quaternion:[0,0,-1,0]};
 const x=interpolatePose(a,b,.5);expect(x.position).toEqual([1,2,3]);expect(Math.hypot(...x.quaternion)).toBeCloseTo(1);
 expect(interpolatePose(a,{...a,quaternion:[0,0,0,-1]},.5).quaternion).toEqual(a.quaternion);
 expect(a.position).toEqual([0,0,0]);
});
