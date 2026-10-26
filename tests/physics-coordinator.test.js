import {test,expect} from 'bun:test';
import {PhysicsCoordinator} from '../lib/physics-coordinator.js';
import {PhysicsBuildPool} from '../lib/physics-build-pool.js';
import {fixture} from '../vendor/cad-core/tests/physical-model.test.js';
const settle=()=>new Promise(r=>setTimeout(r,0));
const fake=()=>({closed:false,checks:{finiteState:true},close(){this.closed=true;},pause(){this.paused=true;},resume(){this.paused=false;},command(a){this.commanded=a;}});
test('physics edits rebuild the whole scene stopped; stale candidates cannot activate',async()=>{
 const jobs=[],c=new PhysicsCoordinator({prepare:(model,options)=>new Promise(resolve=>jobs.push({model,options,resolve}))}),m=fixture();
 c.update(m);const first=fake(),other=fake();jobs[0].resolve(first);jobs[1].resolve(other);await settle();expect(c.start().ok).toBe(true);
 const changed=structuredClone(m);changed.bodies[1].inertial.mass=2;c.update(changed);
 expect(first.closed).toBe(true);expect(other.closed).toBe(true);expect(c.running).toBe(false);expect(c.gate(['c']).pending).toBe(true);
 const late=fake();c.invalidate();jobs[2].resolve(late);await settle();expect(late.closed).toBe(true);
 c.update(changed);const a=fake(),b=fake();jobs[4].resolve(a);await settle();expect(c.start(['a']).pending).toBe(true);
 jobs[5].resolve(b);await settle();expect(a.paused).toBe(true);expect(b.paused).toBe(true);expect(c.running).toBe(false);
 expect(()=>c.motors({volts:{},seconds:1})).toThrow('Start physics');expect(c.start().ok).toBe(true);c.close();
});
test('failed preparation never reports ready and closing disposes late workers',async()=>{
 const c=new PhysicsCoordinator({prepare:async()=>{throw Error('invalid inertia');}});c.update(fixture());await settle();expect(c.gate(['a'])).toMatchObject({ok:false,pending:false});expect(c.status().components[0].error).toBe('invalid inertia');c.close();
});
test('background pool bounds native concurrency and cancels queued work',async()=>{
 const pool=new PhysicsBuildPool(1),done=[],abort=new AbortController();let resolve;
 const first=pool.run(()=>new Promise(r=>resolve=r));await settle();
 const second=pool.run(async()=>done.push('second'),abort.signal);abort.abort();await expect(second).rejects.toThrow('superseded');
 const third=pool.run(async()=>done.push('third'));expect(pool.active).toBe(1);resolve();await first;await third;expect(done).toEqual(['third']);
});

test('a scene must finish validation before explicit start; unchanged queries do not reset it',async()=>{
 const jobs=[],c=new PhysicsCoordinator({prepare:()=>new Promise(resolve=>jobs.push(resolve))});c.update(fixture());
 const first=fake(),other=fake();jobs[0](first);await settle();expect(c.start(['a']).pending).toBe(true);jobs[1](other);await settle();
 expect(c.start(['a']).ok).toBe(true);expect(first.paused).toBe(false);expect(other.paused).toBe(true);
 c.update(fixture());expect(jobs.length).toBe(2);expect(c.running).toBe(true);
 c.invalidate();expect(first.paused).toBe(true);expect(c.running).toBe(false);c.update(fixture());expect(jobs.length).toBe(4);c.close();
});
