// Browser Xbox standard mapping -> WPILib Xbox mapping. The robot program
// retains ownership of deadbands, field-relative driving and mechanism commands.
export function xbox(pad,port){
 const axis=i=>Math.max(-1,Math.min(1,Number(pad.axes[i])||0));
 const value=i=>Math.max(0,Math.min(1,Number(pad.buttons[i]?.value)||0));
 const down=i=>Boolean(pad.buttons[i]?.pressed);
 let buttons=0;[0,1,2,3,4,5,8,9,10,11].forEach((source,target)=>{if(down(source))buttons|=1<<target;});
 const x=Number(down(15))-Number(down(14)),y=Number(down(13))-Number(down(12));
 const pov=x||y?(Math.round(Math.atan2(x,-y)*180/Math.PI)+360)%360:-1;
 return {port,axes:[axis(0),axis(1),value(6),value(7),axis(2),axis(3)],buttons,pov};
}
export function keyboard(keys){
 const down=key=>Number(keys.has(key)),slow=keys.has('ShiftLeft')||keys.has('ShiftRight');
 const x=down('KeyD')-down('KeyA'),y=down('KeyS')-down('KeyW'),scale=(slow?.5:1)/Math.max(1,Math.hypot(x,y));
 // Translation and turning are full-stick by default; robot code owns shaping/acceleration.
 return {port:1,axes:[x*scale,y*scale,0,0,(down('KeyE')-down('KeyQ'))*(slow?.35:1),0],buttons:0,pov:-1};
}

// One request at a time; each packet samples the latest input, never a backlog
// of historical stick positions. Sequence numbers also fence delayed packets.
export class PracticeInput {
 constructor({send,sample,onChange=()=>{},stream=crypto.randomUUID(),interval=20}){
  Object.assign(this,{send,sample,onChange,stream,interval});this.sequence=0;this.active=false;this.pending=false;this.timer=null;this.generation=0;this.stopReason='';
 }
 start(){if(this.active)return;this.active=true;this.stopReason='';this.generation++;this.onChange();this.pump();}
 stop(reason='Stopped'){if(!this.active)return;this.active=false;this.stopReason=reason;this.generation++;clearTimeout(this.timer);this.onChange();this.pump();}
 async pump(){
  if(this.pending)return;this.pending=true;const generation=this.generation,enabled=this.active;
  try{
   const controllers=enabled?this.sample():[];
   await this.send({mode:this.active?'teleop':'disabled',matchTime:-1,controllers:this.active?controllers:[],controlStream:this.stream,sequence:++this.sequence});
  }catch(error){if(this.active){this.active=false;this.stopReason=error.message;this.generation++;this.onChange();}}
  finally{this.pending=false;}
  if(generation!==this.generation){this.pump();return;}
  if(this.active)this.timer=setTimeout(()=>this.pump(),this.interval);
 }
 // pagehide cannot wait for an in-flight request. A higher sequence ensures
 // that an older input arriving afterwards cannot re-enable the robot.
 departure(){this.stop('Page closed');return {mode:'disabled',controllers:[],controlStream:this.stream,sequence:++this.sequence};}
}
