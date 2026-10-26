// Bounded background workers. Cancellation removes queued work and terminates
// running native processes through the task's AbortSignal.
export class PhysicsBuildPool {
 constructor(limit=2){if(!Number.isInteger(limit)||limit<1)throw Error('Invalid worker limit');this.limit=limit;this.active=0;this.queue=[];}
 run(task,signal){return new Promise((resolve,reject)=>{
  const job={task,signal,resolve,reject};
  job.abort=()=>{const i=this.queue.indexOf(job);if(i>=0){this.queue.splice(i,1);reject(Error('Physics build superseded'));}};
  if(signal?.aborted)return reject(Error('Physics build superseded'));
  signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.drain();
 });}
 drain(){while(this.active<this.limit&&this.queue.length){const job=this.queue.shift();job.signal?.removeEventListener('abort',job.abort);if(job.signal?.aborted){job.reject(Error('Physics build superseded'));continue;}this.active++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{this.active--;this.drain();});}}
}
