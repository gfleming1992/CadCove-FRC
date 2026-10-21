import {test,expect} from 'bun:test';
import {validateMechanism,mechanismPose,resolveJoint} from '../src/core/mechanism.js';
const model=()=>({schema:1,units:'mm-deg',bodies:[{id:'base',fixed:true,origin:[0,0,0],parts:['frame']},...['a','b','c','d'].map((id,i)=>({id,fixed:false,origin:[i*20,0,0],parts:[id+'-gear',id+'-shaft']}))],joints:['a','b','c','d'].map((id,i)=>({id:id+'-axis',type:'revolute',parent:'base',child:id,origin:[i*20,0,0],axis:[0,0,1]})),relations:[{id:'gear',type:'gear',driver:'a-axis',follower:'b-axis',driverTeeth:20,followerTeeth:40,direction:-1},{id:'belt',type:'belt',driver:'b-axis',follower:'c-axis',driverTeeth:20,followerTeeth:40,direction:1},{id:'chain',type:'chain',driver:'c-axis',follower:'d-axis',driverTeeth:16,followerTeeth:32,direction:1}],motors:[{id:'motor',joint:'a-axis'}]});
test('one shared ratio graph drives gears, pulleys, chains and all parts on a shaft',()=>{
 const m=validateMechanism(model()),p=mechanismPose(m,'motor',360);
 expect(p.angles).toEqual({'a-axis':360,'b-axis':-180,'c-axis':-90,'d-axis':-45});
 expect(p.transforms['b-gear']).toEqual(p.transforms['b-shaft']);
 // Pivot is invariant under rotation (b is centered at x=20).
 const t=p.transforms['b-gear'];expect(t[0]*20+t[3]).toBeCloseTo(20);expect(t[4]*20+t[7]).toBeCloseTo(0);
 expect(mechanismPose(m,'d-gear',-45).angles).toEqual(p.angles);
 expect(resolveJoint(m,'a-shaft')).toBe('a-axis');
});
test('reject unknown parts, nonunit axes, cycles, duplicate ownership and contradictory phase',()=>{
 expect(()=>validateMechanism(model(),['frame'])).toThrow('Unknown');
 const a=model();a.joints[0].axis=[0,0,2];expect(()=>validateMechanism(a)).toThrow();
 const b=model();b.relations.push({id:'loop',type:'gear',driver:'d-axis',follower:'a-axis',driverTeeth:1,followerTeeth:1,direction:1});expect(()=>validateMechanism(b)).toThrow('Closed-loop');
 const c=model();c.bodies[1].parts.push('frame');expect(()=>validateMechanism(c)).toThrow('multiply');
 const d=model();d.relations[0].phaseDeg=30;expect(()=>validateMechanism(d)).toThrow('phase');
});
test('nonfinite angles and follower limits fail before any pose is returned',()=>{
 const v=model();v.joints[1].limitsDeg=[-45,45];const m=validateMechanism(v);
 expect(()=>mechanismPose(m,'a-gear',100)).toThrow('limit');expect(()=>mechanismPose(m,'a-gear',NaN)).toThrow('finite');
});

import {compileTrajectory,evaluateTrajectory,trajectorySamples} from '../src/core/mechanism-motion.js';
const sweep=[{seconds:1,acceleration:30},{seconds:2,acceleration:0},{seconds:1,acceleration:-30}];
test('exact acceleration segments and coupled joints use absolute elapsed time',()=>{
 const m=validateMechanism(model()),plan=compileTrajectory(m,{units:'deg-s',tracks:[{target:'a-gear',endPosition:90,segments:sweep}]},{});
 expect(evaluateTrajectory(m,plan,1).angles['a-axis']).toBeCloseTo(15);
 expect(evaluateTrajectory(m,plan,3).angles['a-axis']).toBeCloseTo(75);
 expect(evaluateTrajectory(m,plan,4).angles['b-axis']).toBeCloseTo(-45);
 expect(trajectorySamples(plan,2)[0]).toMatchObject({position:45,velocity:30,acceleration:0});
 expect(()=>compileTrajectory(m,{units:'deg-s',tracks:[{target:'a',endPosition:100,segments:sweep}]},{})).toThrow('end position');
 expect(()=>compileTrajectory(m,{units:'deg-s',tracks:[{target:'a',segments:sweep},{target:'b',segments:sweep}]},{})).toThrow('coupled');
});
test('multiple independent tracks, delayed starts, and finite repeats share a timeline',()=>{
 const raw=model();raw.relations=[];const m=validateMechanism(raw);
 const back=[...sweep,...sweep.map(s=>({...s,acceleration:-s.acceleration}))];
 const plan=compileTrajectory(m,{units:'deg-s',repeat:2,tracks:[{target:'a',segments:back},{target:'b',startSeconds:1,segments:back}]},{});
 expect(plan.duration).toBe(18);
 expect(evaluateTrajectory(m,plan,.5).angles['b-axis']).toBe(0);
 expect(evaluateTrajectory(m,plan,4).angles['a-axis']).toBe(90);
 expect(evaluateTrajectory(m,plan,4).angles['b-axis']).toBe(75);
 expect(evaluateTrajectory(m,plan,18).angles['a-axis']).toBeCloseTo(0);
 expect(()=>compileTrajectory(m,{units:'deg-s',repeat:2,tracks:[{target:'a',segments:sweep}]},{})).toThrow('starting position');
});
test('reject interior limit violations even when endpoint is valid',()=>{
 const raw=model();raw.joints[0].limitsDeg=[-10,10];const m=validateMechanism(raw);
 expect(()=>compileTrajectory(m,{units:'deg-s',tracks:[{target:'a',velocity:30,segments:[{seconds:2,acceleration:-30}]}]},{})).toThrow('limit');
});
test('constant jerk integration preserves velocity and acceleration between segments',()=>{
 const m=validateMechanism(model());
 const plan=compileTrajectory(m,{units:'deg-s',tracks:[{target:'a',segments:[{seconds:1,jerk:60},{seconds:1,jerk:-60},{seconds:1,jerk:-60},{seconds:1,jerk:60}]}]},{});
 expect(trajectorySamples(plan,1)[0]).toMatchObject({position:10,velocity:30,acceleration:60});
 expect(evaluateTrajectory(m,plan,4).angles['a-axis']).toBeCloseTo(120);
});
