import {compileFoldMotion,FoldSurfaces} from './fold-motion.js';
import {compileSolvedMotion,evaluateSolvedMotion} from './solved-motion.js';
import {BeltSurfaces} from './belt-motion.js';
import {validateMechanism,mechanismPose,resolveJoint,identityTransform} from './mechanism.js';
export class MechanismMotion {
  constructor(viewer){this.viewer=viewer;this.angles={};this.running=false;this.frame=null;this.scene=null;}
  stop(){this.running=false;if(this.frame!==null)cancelAnimationFrame(this.frame);this.frame=null;if(this.playback?.status==='playing')this.playback.status='stopped';return this.state();}
  state(){return {running:this.running,angles:{...this.angles},error:this.error??null,playback:this.playback?{id:this.playback.id,elapsed:this.playback.elapsed,duration:this.playback.duration,status:this.playback.status,samples:['solved','fold'].includes(this.playback.kind)?null:trajectorySamples(this.playback,this.playback.elapsed),kind:this.playback.kind??'trajectory'}:null};}
  load(value){
    const scene=this.viewer.scene;
    if(!scene)throw Error('Build the model first');
    const model=validateMechanism(value,scene.parts.map(p=>p.id));
    if(this.scene!==scene||JSON.stringify(this.model)!==JSON.stringify(model)){
      const previous=this.scene===scene?this.model:null,angles={};
      const sameRelations=previous&&JSON.stringify(previous.relations)===JSON.stringify(model.relations);
      for(const joint of model.joints){
        const old=previous?.joints.find(j=>j.id===joint.id);
        const same=sameRelations&&JSON.stringify(old)===JSON.stringify(joint)&&
          JSON.stringify(previous.bodies.find(b=>b.id===joint.child))===JSON.stringify(model.bodies.find(b=>b.id===joint.child));
        angles[joint.id]=same?this.angles[joint.id]:joint.bindAngleDeg;
      }
      let pose={angles,transforms:Object.fromEntries(scene.parts.map(p=>[p.id,identityTransform()]))};
      for(const joint of model.joints.filter(j=>!model.relations.some(r=>r.follower===j.id))){
        const next=mechanismPose(model,joint.id,angles[joint.id],pose.angles);
        pose={angles:next.angles,transforms:{...pose.transforms,...next.transforms}};
      }
      const belts=new BeltSurfaces(model,scene);
      this.pendingTopology={...(previous?this.belts?.originals():{}),...belts.renderParts()};
      if(this.folds&&this.scene===scene){this.viewer.setDeformedTopology?.(this.folds.originals());}this.folds=null;
      this.stop();this.playback=null;this.model=model;this.scene=scene;this.angles=pose.angles;this.error=null;
      this.belts=belts;
      // Clear removed bindings and preserve unchanged joints without replacing
      // the scene or uploading geometry. Validate before touching live state.
      if(previous)this.apply(pose);
    }
    return this;
  }
  apply(pose){
    if(!this.viewer.draws){
      this.viewer.setAssembly({prototypes:this.scene.parts.map(p=>({...p})),instances:this.scene.parts.map(p=>({id:p.id,asset:p.id,color:p.color,transform:identityTransform()}))},false);
    }
    if(this.pendingTopology){this.viewer.setDeformedTopology?.(this.pendingTopology);this.pendingTopology=null;}
    this.viewer.clearMarkers();this.viewer.setTransforms(pose.transforms);this.angles=pose.angles;this.updateVisuals(pose);
  }
  updateVisuals(pose){
    if(pose.deformations)this.viewer.setDeformedParts?.(pose.deformations);
    if(this.belts?.belts.length)this.viewer.setDeformedParts?.(this.belts.evaluate(pose.angles));
  }

  rotate(part,degrees){const pose=mechanismPose(this.model,part,degrees,this.angles);this.stop();this.playback=null;this.apply(pose);return this.state();}
  reset(){this.stop();if(this.folds){this.viewer.setDeformedTopology?.(this.folds.originals());this.folds=null;}this.playback=null;this.angles=Object.fromEntries((this.model?.joints??[]).map(j=>[j.id,j.bindAngleDeg]));const transforms=Object.fromEntries(this.scene.parts.map(p=>[p.id,identityTransform()]));this.apply({angles:this.angles,transforms});this.error=null;return this.state();}
  playSolved(value,revision){
    const scene=this.viewer.scene;if(!scene)throw Error('Build the model first');
    const plan=compileSolvedMotion(value,scene.parts.map(p=>p.id),revision,this.scene===scene?this.model:null);
    // Restore any belt deformation from the existing animator before replacing it.
    if(this.scene===scene)this.reset();else this.stop();
    if(this.scene!==scene){this.model=null;this.belts=null;this.pendingTopology=null;}
    this.scene=scene;this.error=null;
    this.playback={...plan,id:crypto.randomUUID(),elapsed:0,status:'playing'};
    this.apply(evaluateSolvedMotion(plan,0));return this.resume();
  }
  playFold(value,revision){
    const scene=this.viewer.scene;if(!scene)throw Error('Build the model first');
    const plan=compileFoldMotion(value,scene,revision),folds=new FoldSurfaces(plan,scene);
    if(this.scene===scene)this.reset();else this.stop();
    this.scene=scene;this.model=null;this.belts=null;this.folds=folds;this.error=null;
    this.pendingTopology=folds.renderParts();
    this.playback={...plan,id:crypto.randomUUID(),elapsed:0,status:'playing'};
    this.apply(folds.evaluate(plan,0));return this.resume();
  }
  evaluate(plan,time){return plan.kind==='fold'?this.folds.evaluate(plan,time):plan.kind==='solved'?evaluateSolvedMotion(plan,time):evaluateTrajectory(this.model,plan,time);}
  play(request){
    const plan=compileTrajectory(this.model,request,this.angles);
    this.stop();this.error=null;
    this.playback={...plan,id:crypto.randomUUID(),elapsed:0,status:'playing'};
    this.apply(evaluateTrajectory(this.model,plan,0));
    return this.resume();
  }
  pause(){
    if(!this.playback)throw Error('No trajectory loaded');
    this.stop();this.playback.status='paused';return this.state();
  }
  seek(seconds){
    if(!this.playback||!Number.isFinite(seconds)||seconds<0||seconds>this.playback.duration)throw Error('Seek time is outside the trajectory');
    this.stop();this.apply(this.evaluate(this.playback,seconds));
    this.playback.elapsed=seconds;this.playback.status='paused';return this.state();
  }
  resume(){
    const plan=this.playback;if(!plan)throw Error('No trajectory loaded');
    this.stop();this.running=true;plan.status='playing';
    const start=performance.now()-plan.elapsed*1000,scene=this.scene;
    const tick=now=>{
      if(!this.running)return;
      if(this.viewer.scene!==scene){this.stop();plan.status='stopped';return;}
      plan.elapsed=Math.min(plan.duration,Math.max(0,(now-start)/1000));
      try{this.apply(this.evaluate(plan,plan.elapsed));}
      catch(error){this.error=error.message;this.stop();plan.status='error';return;}
      if(plan.elapsed>=plan.duration){this.stop();plan.status='completed';return;}
      this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);return this.state();
  }
  animate(part,rpm,seconds=10){
    if(!Number.isFinite(rpm)||Math.abs(rpm)>600||!Number.isFinite(seconds)||seconds<=0||seconds>300)throw Error('Use finite RPM within ±600 and duration 0–300 seconds');
    const joint=resolveJoint(this.model,part),startAngle=this.angles[joint];
    // Reject a bounded sweep before changing any displayed pose.
    mechanismPose(this.model,joint,startAngle+rpm*6*seconds,this.angles);
    this.stop();this.playback=null;this.error=null;this.running=true;const start=performance.now(),scene=this.scene;
    const tick=now=>{
      if(!this.running)return;
      if(this.viewer.scene!==scene){this.stop();return;}
      const elapsed=Math.min(seconds,(now-start)/1000);
      try{this.apply(mechanismPose(this.model,joint,startAngle+rpm*6*elapsed,this.angles));}
      catch(error){this.error=error.message;this.stop();return;}
      if(elapsed>=seconds){this.stop();return;}
      this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);return this.state();
  }
}

// Each segment uses constant jerk. Position, velocity and acceleration are
// integrated analytically, so playback is independent of rendering frame rate.
function integrate(segment,t){
  const {position:q,velocity:v,acceleration:a,jerk:j}=segment;
  return {position:q+v*t+a*t*t/2+j*t*t*t/6,velocity:v+a*t+j*t*t/2,acceleration:a+j*t};
}
export function compileTrajectory(model,request,initial){
  if(request?.units!=='deg-s'||!Array.isArray(request.tracks)||!request.tracks.length||request.tracks.length>100)throw Error('Expected deg-s units and 1–100 motion tracks');
  const roots=new Set(),tracks=[];let duration=0;
  const repeat=request.repeat??1;if(!Number.isSafeInteger(repeat)||repeat<1||repeat>1000)throw Error('Repeat must be an integer from 1 to 1000');
  for(const track of request.tracks){
    const joint=resolveJoint(model,track.target);
    let root=joint;const incoming=new Map(model.relations.map(r=>[r.follower,r]));
    while(incoming.has(root))root=incoming.get(root).driver;
    if(roots.has(root))throw Error('Conflicting tracks drive coupled joints: '+root);
    roots.add(root);
    if(!Array.isArray(track.segments)||!track.segments.length||track.segments.length>1000)throw Error('Expected 1–1000 segments per track');
    let state={position:initial[joint]??model.joints.find(j=>j.id===joint).bindAngleDeg,velocity:track.velocity??0,acceleration:track.acceleration??0};
    if(!Object.values(state).every(Number.isFinite))throw Error('Non-finite initial motion state');
    let time=track.startSeconds??0;
    if(!Number.isFinite(time)||time<0||time>300)throw Error('Invalid track start time');
    if(time>0&&(state.velocity!==0||state.acceleration!==0))throw Error('Delayed tracks must start at rest');
    const segments=[];if(time>0)segments.push({...state,jerk:0,start:0,seconds:time});
    for(const input of track.segments){
      const seconds=input.seconds,jerk=input.jerk??0;
      if(!Number.isFinite(seconds)||seconds<=0||!Number.isFinite(jerk)||input.acceleration!==undefined&&!Number.isFinite(input.acceleration))throw Error('Invalid segment duration, acceleration or jerk');
      const segment={...state,acceleration:input.acceleration??state.acceleration,jerk,start:time,seconds};
      // Validate extrema as well as endpoints; coupled joints are checked too.
      const candidates=[0,seconds],a=segment.acceleration,v=segment.velocity;
      if(jerk===0){if(a!==0)candidates.push(-v/a);}
      else{const discriminant=a*a-2*jerk*v;if(discriminant>=0){candidates.push((-a+Math.sqrt(discriminant))/jerk,(-a-Math.sqrt(discriminant))/jerk);}}
      for(const t of candidates.filter(t=>t>=0&&t<=seconds))mechanismPose(model,joint,integrate(segment,t).position,initial);
      state=integrate(segment,seconds);segments.push(segment);time+=seconds;
      if(time>300)throw Error('Trajectory exceeds 300 seconds');
    }
    if(Math.abs(state.velocity)>1e-7)throw Error('A track must finish at rest; add a deceleration segment');
    if(track.endPosition!==undefined&&(!Number.isFinite(track.endPosition)||Math.abs(state.position-track.endPosition)>1e-6))throw Error('Trajectory does not reach requested end position');
    if(repeat>1&&Math.abs(state.position-(initial[joint]??model.joints.find(j=>j.id===joint).bindAngleDeg))>1e-6)throw Error('Repeated tracks must return to their starting position');
    tracks.push({joint,segments,duration:time});duration=Math.max(duration,time);
  }
  if(duration*repeat>300)throw Error('Repeated trajectory exceeds 300 seconds');
  return {tracks,cycleDuration:duration,duration:duration*repeat,repeat,initial:{...initial}};
}
export function evaluateTrajectory(model,plan,seconds){
  let angles={...plan.initial},pose;
  for(const sample of trajectorySamples(plan,seconds)){
    pose=mechanismPose(model,sample.joint,sample.position,angles);angles=pose.angles;
  }
  return pose;
}

export function trajectorySamples(plan,seconds){
  const elapsed=Math.min(plan.duration,Math.max(0,seconds));
  const cycleTime=elapsed===plan.duration?plan.cycleDuration:elapsed%plan.cycleDuration;
  return plan.tracks.map(track=>{
    const time=Math.min(track.duration,cycleTime);
    const segment=track.segments.find(s=>time<s.start+s.seconds)??track.segments.at(-1);
    const sample=integrate(segment,time-segment.start);
    if(cycleTime>=track.duration){sample.velocity=0;sample.acceleration=0;}
    return {joint:track.joint,...sample};
  });
}
