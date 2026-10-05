import {test,expect} from 'bun:test';
import {SimulationTasks} from '../extensions/vscode/src/simulation-tasks.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
test('shutdown during installation prevents task creation and rejects later starts',async()=>{
 const install=deferred(),stopped=[],tasks=new SimulationTasks(async r=>stopped.push(r));let launches=0;
 const start=tasks.start('team',async(r,assertOpen)=>{await install.promise;assertOpen();launches++;r.execution={};});
 const rejected=start.catch(error=>error);const closing=tasks.close();install.resolve();expect((await rejected).message).toContain('shutting down');await closing;
 expect(launches).toBe(0);expect(stopped).toEqual([]);expect(()=>tasks.start('other',async()=>{})).toThrow('shutting down');
});
test('a task created after shutdown began is stopped before shutdown resolves',async()=>{
 const creation=deferred(),stop=deferred(),stopped=[],tasks=new SimulationTasks(async r=>{stopped.push(r.execution);await stop.promise;}),execution={};
 const start=tasks.start('team',async r=>{r.execution=await creation.promise;});const rejected=start.catch(error=>error);
 let closed=false;const closing=tasks.close().then(()=>closed=true);creation.resolve(execution);await new Promise(r=>setTimeout(r,0));
 expect(stopped).toEqual([execution]);expect(closed).toBe(false);stop.resolve();expect((await rejected).message).toContain('shutting down');await closing;expect(closed).toBe(true);expect(tasks.records.size).toBe(0);
});
test('duplicate starts are reserved before waits; failed launches permit retry',async()=>{
 const install=deferred(),tasks=new SimulationTasks(async()=>{});const first=tasks.start('team',async()=>{await install.promise;throw Error('install failed');});
 expect(()=>tasks.start('team',async()=>{})).toThrow('already has');const rejected=first.catch(error=>error);install.resolve();expect((await rejected).message).toBe('install failed');
 const result=await tasks.start('team',async r=>{r.execution={};r.project='team.json';});expect(result.status).toBe('starting');expect(result.project).toBe('team.json');await tasks.close();
});
test('close is idempotent, stops only owned tasks, and tolerates an owned stop failure',async()=>{
 const stopped=[],tasks=new SimulationTasks(async r=>{stopped.push(r.root);if(r.root==='a')throw Error('stop failed');});
 const a={},b={};await tasks.start('a',async r=>r.execution=a);await tasks.start('b',async r=>r.execution=b);
 tasks.ended({unrelated:true});expect(tasks.records.size).toBe(2);tasks.ended(b);expect(tasks.records.size).toBe(1);
 const close=tasks.close();expect(tasks.close()).toBe(close);const result=await close;expect(stopped).toEqual(['a']);expect(result[0].status).toBe('rejected');expect(tasks.records.size).toBe(0);
});
