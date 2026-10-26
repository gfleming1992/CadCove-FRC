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

test('live mechanism additions preserve existing pose and remove stale transforms without replacing geometry',async()=>{
 const {MechanismMotion}=await import('../src/core/mechanism-motion.js');
 const value=model(),parts=value.bodies.flatMap(b=>b.parts).map(id=>({id}));parts.push({id:'extra'});
 let transforms;
 const scene={parts},viewer={scene,draws:[],clearMarkers(){},setTransforms(v){transforms=v;},setScene(){throw Error('must not replace geometry');}};
 const motion=new MechanismMotion(viewer).load(value),joint=value.joints[0].id;
 motion.rotate(joint,20);const before=motion.angles[joint];
 const added=structuredClone(value);added.bodies.push({id:'extra-body',fixed:false,origin:[0,0,0],parts:['extra']});added.joints.push({id:'extra-axis',type:'revolute',parent:value.joints[0].parent,child:'extra-body',origin:[0,0,0],axis:[0,0,1]});
 motion.load(added);expect(motion.angles[joint]).toBe(before);expect(viewer.scene).toBe(scene);
 motion.rotate('extra-axis',45);expect(transforms.extra[0]).toBeCloseTo(Math.SQRT1_2);
 motion.load(value);expect(transforms.extra).toEqual([1,0,0,0,0,1,0,0,0,0,1,0]);expect(motion.angles[joint]).toBe(before);
 const bad=structuredClone(value);bad.joints[0].axis=[0,0,0];expect(()=>motion.load(bad)).toThrow();expect(motion.angles[joint]).toBe(before);
});

const nested=()=>({schema:1,units:'mm-deg',bodies:[{id:'frame',fixed:true,origin:[0,0,0],parts:['frame']},{id:'module',fixed:false,origin:[10,0,0],parts:['fork']},{id:'wheel',fixed:false,origin:[12,0,0],parts:['tire']}],joints:[{id:'spin',type:'revolute',parent:'module',child:'wheel',origin:[12,0,0],axis:[0,1,0],bindAngleDeg:10},{id:'steer',type:'revolute',parent:'frame',child:'module',origin:[10,0,0],axis:[0,0,1],bindAngleDeg:20}],relations:[]});
const point=(m,p)=>[0,1,2].map(r=>m[r*4+3]+p.reduce((sum,x,k)=>sum+m[r*4+k]*x,0));
const near=(actual,expected)=>actual.forEach((x,i)=>expect(x).toBeCloseTo(expected[i],8));
test('nested wheel spin follows steering around an offset pivot, independent of joint order',()=>{
 const m=validateMechanism(nested());
 const bind=mechanismPose(m,'steer',20);near(point(bind.transforms.tire,[13,0,0]),[13,0,0]);
 const steer=mechanismPose(m,'steer',110);near(point(steer.transforms.tire,[13,0,0]),[10,3,0]);
 const both=mechanismPose(m,'spin',100,steer.angles);
 near(point(both.transforms.tire,[13,0,0]),[10,2,-1]);
 near(point(both.transforms.tire,[12,1,0]),[9,2,0]); // axle rotates with module
 near(point(both.transforms.fork,[13,0,0]),[10,3,0]); // child spin cannot move parent
 const reversed=validateMechanism({...nested(),joints:nested().joints.reverse()});
 near(point(mechanismPose(reversed,'spin',100,steer.angles).transforms.tire,[13,0,0]),[10,2,-1]);
 const back=mechanismPose(m,'steer',20,both.angles);near(point(back.transforms.tire,[13,0,0]),[12,0,-1]);
});
test('body hierarchy rejects cycles, self parents and unknown parents',()=>{
 for(const parent of ['wheel','module','missing']){const m=nested();m.joints[1].parent=parent;expect(()=>validateMechanism(m)).toThrow();}
});

test('three-level assembly and simultaneous parent/child tracks compose without geometry changes',()=>{
 const input=nested();input.bodies.push({id:'tool',fixed:false,origin:[13,0,0],parts:['tool']});input.joints.unshift({id:'tool-axis',type:'revolute',parent:'wheel',child:'tool',origin:[13,0,0],axis:[1,0,0],bindAngleDeg:0});
 const m=validateMechanism(input),initial={steer:20,spin:10,'tool-axis':0};
 const plan=compileTrajectory(m,{units:'deg-s',tracks:['steer','spin','tool-axis'].map(target=>({target,segments:[{seconds:1,acceleration:90},{seconds:1,acceleration:-90}]}))},initial);
 const pose=evaluateTrajectory(m,plan,2);
 near(point(pose.transforms.tool,[13,1,0]),[10,3,-1]);
 expect(pose.angles).toEqual({steer:110,spin:100,'tool-axis':90});
});
test('explicit free body is independent of rotary hierarchy and remains at authored CAD pose',()=>{const m=model();m.bodies.push({id:'ball',fixed:false,free:true,origin:[20,10,30],parts:['ball']});const checked=validateMechanism(m);expect(mechanismPose(checked,'a-axis',30).transforms.ball).toEqual([1,0,0,0,0,1,0,0,0,0,1,0]);m.bodies.at(-1).fixed=true;expect(()=>validateMechanism(m)).toThrow('Free body must be dynamic');m.bodies.at(-1).fixed=false;m.joints.push({id:'bad',type:'revolute',parent:'base',child:'ball',origin:[20,10,30],axis:[0,1,0]});expect(()=>validateMechanism(m)).toThrow('Free body cannot own');m.joints.pop();delete m.bodies.at(-1).free;expect(()=>validateMechanism(m)).toThrow('Moving body has no joint');});
