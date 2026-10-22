import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {compileMechanism} from './mechanism-export.js';

// Owned native process, never Java, Driver Station, or a hardware connection.
export class MechanismSession {
 constructor(binary,{onState=()=>{},onError=()=>{}}={}){this.binary=binary;this.onState=onState;this.onError=onError;this.closed=false;this.pending=null;this.volts={};this.deadline=0;}
 async start(model,parts){
  if(this.child||this.closed)throw Error('Session already started or closed');
  this.compiled=compileMechanism(model,parts);
  for(const id of parts)if(!this.compiled.bindings[id])throw Error('Part lacks rigid body: '+id);
  this.motors=new Set(this.compiled.world.motors.map(m=>m.id));
  this.child=spawn(this.binary,[],{stdio:['pipe','pipe','pipe'],env:{...process.env,CADCOVE_PHYSICS_LOG:'0'},windowsHide:true});
  this.child.stderr.on('data',()=>{});
  this.child.stdin.on('error',error=>this.fail(error));
  this.child.on('error',error=>this.fail(error));
  this.child.on('exit',()=>{if(!this.closed)this.fail(Error('Native mechanism engine exited'));});
  this.lines=createInterface({input:this.child.stdout});
  this.lines.on('line',line=>{
   const p=this.pending;if(!p)return this.fail(Error('Unexpected native response'));
   this.pending=null;clearTimeout(p.timer);
   try{const result=JSON.parse(line);if(!result.ok)throw Error(result.error??'Native mechanism request failed');p.resolve(result);}catch(e){p.reject(e);}
  });
  try{this.state=await this.request({op:'load',world:this.compiled.world});this.onState(this.state);return this.state;}
  catch(e){this.close();throw e;}
 }
 request(value){
  if(this.closed||!this.child) return Promise.reject(Error('Native mechanism session is closed'));
  if(this.pending)return Promise.reject(Error('Native mechanism request already in flight'));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(Error('Native mechanism engine timed out')),10000);this.pending={resolve,reject,timer};this.child.stdin.write(JSON.stringify(value)+'\n');});
 }
 command({volts,seconds}){
  if(this.closed||!this.state)throw Error('Start physics first');
  if(!volts||typeof volts!=='object'||Array.isArray(volts)||!Number.isFinite(seconds)||seconds<=0||seconds>30)throw Error('Use motor voltages and a duration of 0–30 seconds');
  for(const [id,v] of Object.entries(volts))if(!this.motors.has(id)||!Number.isFinite(v)||Math.abs(v)>12)throw Error('Unknown motor or voltage outside ±12 V: '+id);
  this.volts={...volts};this.deadline=performance.now()+seconds*1000;
  if(!this.timer&&!this.stepping)this.schedule();
  return {ok:true,volts:this.volts,seconds};
 }
 schedule(){if(!this.closed)this.timer=setTimeout(()=>{this.timer=null;void this.step();},20);}
 async step(){
  if(this.closed)return;this.stepping=true;
  try{
   const volts=performance.now()<this.deadline?this.volts:{};
   this.state=await this.request({op:'step',steps:4,volts});
   this.onState(this.state);
  }catch(e){this.fail(e);}finally{this.stepping=false;this.schedule();}
 }
 zero(){this.volts={};this.deadline=0;return {ok:true};}
 fail(error){if(this.closed)return;this.onError(error);this.close(error);}
 close(error=Error('Native mechanism session closed')){
  this.closed=true;clearTimeout(this.timer);this.timer=null;
  if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}
  this.lines?.close();this.child?.stdin.destroy();this.child?.kill();
 }
}
