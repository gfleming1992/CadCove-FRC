// Own task admission and shutdown independently of VS Code. Closing drains
// in-flight starts before releasing ownership, including executeTask promises
// that resolve after deactivation began.
export class SimulationTasks {
  constructor(stop){this.stop=stop;this.records=new Map();this.pending=new Set();this.closing=false;}
  assertOpen(){if(this.closing)throw Error('CadCove is shutting down; no new simulation can start.');}
  start(root,launch){
    this.assertOpen();
    if(this.records.has(root))throw Error('This workspace already has a simulation task. Stop it before starting another.');
    const record={root};this.records.set(root,record);
    const pending=(async()=>{
      try{
        await launch(record,()=>this.assertOpen());
        this.assertOpen();
        return {ok:true,project:record.project,status:'starting'};
      }catch(error){
        try{if(record.execution)await this.stopRecord(record);}
        finally{if(this.records.get(root)===record)this.records.delete(root);}
        throw error;
      }
    })();
    this.pending.add(pending);
    // Use both handlers to avoid an unhandled rejection from a detached finally.
    pending.then(()=>this.pending.delete(pending),()=>this.pending.delete(pending));
    return pending;
  }
  ended(execution){for(const [root,record] of this.records)if(record.execution===execution){record.ended=true;this.records.delete(root);}}
  stopRecord(record){return record.stopping??=(async()=>{await this.stop(record);})();}
  close(){
    if(this.shutdown)return this.shutdown;
    this.closing=true;
    return this.shutdown=(async()=>{
      await Promise.allSettled([...this.pending]);
      const result=await Promise.allSettled([...this.records.values()].map(record=>this.stopRecord(record)));
      this.records.clear();return result;
    })();
  }
}
