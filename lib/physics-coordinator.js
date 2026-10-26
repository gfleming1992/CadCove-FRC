import {createHash,randomUUID} from 'node:crypto';
import {physicalDependencies,physicalSubset,validatePhysicalModel} from './physical-model.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// One candidate process per connected dependency component. All potential
// collision pairs join a component, so independent worlds cannot miss contacts.
export class PhysicsCoordinator {
 constructor({prepare,onEvent=()=>{},onState=()=>{}}){Object.assign(this,{prepare,onEvent,onState});this.records=new Map();this.events=[];this.sequence=0;this.epoch=0;this.closed=false;this.running=false;this.activeBodies=new Set();}
 emit(record){const event={sequence:++this.sequence,type:'physics-'+record.phase,component:record.id,revision:this.revision,physicsRevision:record.hash,jobId:record.jobId,bodies:record.ids,error:record.error,checks:record.checks,stateTransfer:record.stateTransfer};this.events.push(event);if(this.events.length>256)this.events.shift();this.onEvent(event);}
 invalidate(){if(this.closed)return;this.running=false;this.activeBodies.clear();this.epoch++;for(const r of this.records.values()){r.abort?.abort();r.session?.pause?.();r.phase='outdated';this.emit(r);}}
 update(value,geometry={}){
  if(this.closed)throw Error('Scene closed');
  const model=validatePhysicalModel(value),revision=hash({model,geometry});if(revision===this.revision&&[...this.records.values()].every(r=>!['outdated','failed'].includes(r.phase)))return this.status();
  const graph=physicalDependencies(model),epoch=++this.epoch;
  // A new physical definition resets the complete simulation, never hot-transfers motion.
  this.running=false;this.activeBodies.clear();
  this.revision=hash({model,geometry});this.graph=graph;this.model=model;
  const previous=this.records,next=new Map();this.records=next;
  for(const ids of graph.components){
   const id=hash(ids).slice(0,16),subset=physicalSubset(model,ids),parts=subset.bodies.flatMap(b=>b.parts),revision=hash({subset,geometry:Object.fromEntries(parts.map(p=>[p,geometry[p]??null]))});
   const old=previous.get(id);previous.delete(id);
   old?.abort?.abort();old?.session?.close();
   const r={id,ids,hash:revision,jobId:randomUUID(),phase:'building',abort:new AbortController()};next.set(id,r);this.emit(r);
   const current=()=>!this.closed&&epoch===this.epoch&&this.records.get(id)===r&&!r.abort?.signal.aborted;
   void (async()=>{
    let session;
    try{
     session=await this.prepare(subset,{signal:r.abort.signal,onPhase:phase=>{if(current()){r.phase=phase;this.emit(r);}},onState:state=>{if(this.records.get(id)===r&&r.phase==='ready'&&this.running)this.onState({component:id,physicsRevision:r.hash,state});}});
     if(!current()){session.close();return;}
     r.phase='awaiting-activation';this.emit(r);
     // Candidate is reset to authored initial conditions after its isolated test.
     // No velocities/contact cache are copied across changed physical definitions.
     r.session=session;r.abort=undefined;const previousError=session.onError;session.onError=e=>{previousError?.(e);if(this.records.get(id)===r){r.phase='failed';r.error=e.message;this.emit(r);}};r.checks=session.checks;r.stateTransfer='reset';r.phase='ready';
     session.pause?.();this.emit(r);
     if([...this.records.values()].every(record=>record.phase==='ready'))for(const record of this.records.values())if(record.session.state)this.onState({component:record.id,physicsRevision:record.hash,state:record.session.state,reset:true});
    }catch(e){session?.close();if(current()){r.error=e.message;r.phase='failed';this.emit(r);}}
   })();
  }
  for(const r of previous.values()){r.abort?.abort();r.session?.close();}
  return this.status();
 }
 gate(ids){
  if(!this.graph)return {ok:false,pending:true,reason:'Physical definition has not built'};
  const requested=ids??this.model.bodies.map(b=>b.id),bodies=new Set();
  if(!Array.isArray(requested)||!requested.length)throw Error('Supply nonempty body, part or motor IDs');
  for(const id of requested){const body=this.graph.owners[id]??this.graph.motors[id]??id;if(!this.model.bodies.some(b=>b.id===body))throw Error('Unknown physics dependency '+id);bodies.add(body);}
  const records=[...this.records.values()].filter(r=>r.ids.some(id=>bodies.has(id))),blocked=[...this.records.values()].filter(r=>r.phase!=='ready');
  return blocked.length?{ok:false,pending:blocked.every(r=>r.phase!=='failed'),reason:'Physics dependency is not ready',blocked:blocked.map(r=>({component:r.id,bodies:r.ids,phase:r.phase,jobId:r.jobId,physicsRevision:r.hash,error:r.error}))}:{ok:true,components:records.map(r=>r.id),revision:this.revision};
 }
 start(ids){const g=this.gate(ids);if(!g.ok)return g;if(!this.running)this.activeBodies.clear();this.running=true;for(const id of g.components){const r=this.records.get(id);for(const body of r.ids)this.activeBodies.add(body);r.session.resume?.();}return {...g,mode:'physics'};}
 motors(args){if(!this.running)throw Error('Start physics before commanding motors');if(!args.volts||typeof args.volts!=='object'||Array.isArray(args.volts)||!Number.isFinite(args.seconds)||args.seconds<=0||args.seconds>30||Object.entries(args.volts).some(([id,v])=>!this.graph?.motors[id]||!Number.isFinite(v)||Math.abs(v)>12))throw Error('Invalid motor voltages/duration');const g=this.gate(Object.keys(args.volts??{}));if(!g.ok)return g;for(const id of g.components){const r=this.records.get(id),volts=Object.fromEntries(Object.entries(args.volts).filter(([motor])=>r.ids.includes(this.graph.motors[motor])));r.session.command({...args,volts});}return {ok:true};}
 pause(){this.running=false;for(const r of this.records.values())r.session?.pause?.();return {ok:true,mode:'cad'};}
 status(after=0){return {ok:true,resetPolicy:'whole-scene-stopped',running:this.running,revision:this.revision,sequence:this.sequence,events:this.events.filter(e=>e.sequence>after),eventsTruncated:!!this.events.length&&after<this.events[0].sequence-1,components:[...this.records.values()].map(({id,ids,hash,jobId,phase,error,checks,stateTransfer})=>({id,bodies:ids,physicsRevision:hash,jobId,phase,error,checks,stateTransfer})),dependencies:this.graph};}
 close(){this.closed=true;this.epoch++;for(const r of this.records.values()){r.abort?.abort();r.session?.close();}this.records.clear();}
}
