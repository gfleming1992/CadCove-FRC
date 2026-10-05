// Presentation-only interpolation. Raw simulation snapshots remain authoritative
// for agent queries/captures; no prediction is sent back into physics.
export class LiveMotion {
 constructor({delayMs=50,maxGapMs=250}={}){this.delayMs=delayMs;this.maxGapMs=maxGapMs;this.clear();}
 clear(){this.frames=[];this.runId=null;}
 push(runId,state,now){
  if(runId!==this.runId){this.clear();this.runId=runId;}
  const last=this.frames.at(-1);if(last&&state.tick<=last.state.tick)return;
  if(last&&now-last.now>this.maxGapMs)this.frames=[];
  this.frames.push({state,now});if(this.frames.length>12)this.frames.shift();
 }
 sample(now){
  if(!this.frames.length)return null;
  const target=now-this.delayMs;let a=this.frames[0],b=a;
  for(const frame of this.frames){b=frame;if(frame.now>=target)break;a=frame;}
  const alpha=a===b?1:Math.max(0,Math.min(1,(target-a.now)/(b.now-a.now)));
  return {a:a.state,b:b.state,alpha};
 }
}
export function interpolatePose(a,b,alpha){
 if(!a||alpha>=1)return b;if(alpha<=0)return a;
 const dot=a.quaternion.reduce((v,x,i)=>v+x*b.quaternion[i],0),sign=dot<0?-1:1;
 const q=a.quaternion.map((x,i)=>x*(1-alpha)+sign*b.quaternion[i]*alpha),length=Math.hypot(...q);
 return {position:a.position.map((x,i)=>x+(b.position[i]-x)*alpha),quaternion:q.map(x=>x/length)};
}
