import {test,expect} from 'bun:test';
import {PracticeInput,keyboard,xbox} from '../web/practice-input.js';
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
test('browser standard Xbox maps triggers, sticks, buttons and diagonal POV to WPILib',()=>{
 const pad={axes:[.1,.2,.3,.4],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
 for(const i of [0,8,11,12,15])pad.buttons[i]={pressed:true,value:1};
 pad.buttons[6].value=.6;pad.buttons[7].value=.7;
 expect(xbox(pad,1)).toEqual({port:1,axes:[.1,.2,.6,.7,.3,.4],buttons:1+64+512,pov:45});
 expect(keyboard(new Set(['KeyW','KeyA','KeyQ','ShiftLeft'])).axes).toEqual([-.5/Math.sqrt(2),-.5/Math.sqrt(2),0,0,-.35,0]);
});
test('stop supersedes in-flight driving and does not enqueue old input',async()=>{
 const packets=[];let finish;
 const input=new PracticeInput({sample:()=>[keyboard(new Set(['KeyW']))],send:packet=>{packets.push(packet);return packets.length===1?new Promise(r=>finish=r):Promise.resolve();}});
 input.start();input.stop('blur');expect(packets.length).toBe(1);finish();await flush();
 expect(packets.map(p=>p.mode)).toEqual(['teleop','disabled']);expect(packets[1].controllers).toEqual([]);
 expect(packets[1].sequence).toBeGreaterThan(packets[0].sequence);expect(input.active).toBe(false);
});
test('page departure fences an older request with a higher sequence',async()=>{
 let finish;const input=new PracticeInput({sample:()=>[],send:()=>new Promise(r=>finish=r)});
 input.start();const packet=input.departure();expect(packet.mode).toBe('disabled');expect(packet.sequence).toBe(2);finish();await flush();
 // Complete the queued disabled send as well.
 finish();await flush();expect(input.active).toBe(false);
});
test('lost controller or send failure disables and does not retry driving',async()=>{
 const packets=[];const input=new PracticeInput({sample:()=>{throw Error('Lost gamepad');},send:async p=>packets.push(p)});
 input.start();await flush();expect(input.active).toBe(false);expect(input.stopReason).toBe('Lost gamepad');expect(packets.map(p=>p.mode)).toEqual(['disabled']);
});

test('keyboard requests full stick and keeps diagonal speed equal to cardinal speed',()=>{
 expect(keyboard(new Set(['KeyW'])).axes[1]).toBe(-1);
 const d=keyboard(new Set(['KeyW','KeyD'])).axes;expect(Math.hypot(d[0],d[1])).toBeCloseTo(1);
 expect(keyboard(new Set(['KeyW','ShiftLeft'])).axes[1]).toBe(-.5);
});
