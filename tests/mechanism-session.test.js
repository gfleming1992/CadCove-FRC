import {test,expect} from 'bun:test';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MechanismSession} from '../lib/mechanism-session.js';
const binary=fileURLToPath(new URL('../target/distribution/release/instantcad-sim'+(process.platform==='win32'?'.exe':''),import.meta.url));
const fixture=()=>JSON.parse(readFileSync(new URL('../examples/rotary-mechanism/cad/mechanism.json',import.meta.url)));
test.skipIf(!existsSync(binary))('direct native motor session expires commands and closes without Java',async()=>{
 const m=fixture(),states=[],errors=[],s=new MechanismSession(binary,{onState:r=>states.push(r),onError:e=>errors.push(e.message)});
 try{
  await s.start(m,m.bodies.flatMap(b=>b.parts));
  expect(()=>s.command({volts:{unknown:1},seconds:1})).toThrow('Unknown motor');
  expect(()=>s.command({volts:{'demo-motor':13},seconds:1})).toThrow('voltage');
  expect(()=>s.command({volts:{'demo-motor':1},seconds:31})).toThrow('duration');
  s.command({volts:{'demo-motor':1},seconds:.1});
  await new Promise(r=>setTimeout(r,300));
  expect(states.length).toBeGreaterThan(3);expect(errors).toEqual([]);
  const last=states.at(-1).state??states.at(-1);expect(last.joints['motor-shaft-axis'].position).toBeGreaterThan(.001);
  expect(performance.now()).toBeGreaterThan(s.deadline);
  s.zero();expect(s.volts).toEqual({});
 }finally{s.close();}
 expect(s.closed).toBe(true);await expect(s.request({op:'state'})).rejects.toThrow('closed');
});
test('missing physical properties do not launch a native process',async()=>{
 const m=fixture();delete m.bodies[1].physics;const s=new MechanismSession('/not-an-engine');
 await expect(s.start(m,m.bodies.flatMap(b=>b.parts))).rejects.toThrow('Explicit mass');expect(s.child).toBeUndefined();
});
