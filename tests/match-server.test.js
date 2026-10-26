import {test,expect} from 'bun:test';
import {startMatchServer} from '../lib/match-server.js';
import {AuthoritativePoses,encodePoses,projectPoses,validateDriverInput} from '../lib/match-wire.js';
const body=(x=0)=>({position:[x,0,0],quaternion:[0,0,0,1]});
const frame=(x,tick)=>({poses:projectPoses({bodies:{body:body(x)}},['body']),tick,time:tick*.005});
test('pose protocol uses authoritative updates, requires a complete base and never advances while idle',async()=>{
 const p=new AuthoritativePoses(['body']),a=frame(1,2);p.accept(encodePoses(a,null,1));const before=JSON.stringify(p);
 await Bun.sleep(30);expect(JSON.stringify(p)).toBe(before);
 const b=frame(4,4),bytes=encodePoses(b,{...a,sequence:1},2);p.accept(bytes);expect(p.bodies.body.position[0]).toBe(4);expect(p.time).toBe(.02);
 expect(()=>p.accept(bytes)).toThrow('sequence');expect(()=>new AuthoritativePoses(['body']).accept(bytes)).toThrow('base');
 const invalid=encodePoses(frame(8,6),{...b,sequence:2},3);new DataView(invalid).setFloat32(40,NaN,true);expect(()=>p.accept(invalid)).toThrow('record');expect(p.bodies.body.position[0]).toBe(4);
});
test('input protocol accepts only joystick state, never poses, direct motor commands or invalid ports',()=>{
 const input={type:'input',sequence:1,enabled:true,controllers:[{port:1,axes:[0,-1,0,0,0,0],buttons:0,pov:-1}]};expect(validateDriverInput(input)).toBe(input);
 for(const extra of [{bodies:{}},{volts:{motor:12}},{robotId:'r1'}])expect(()=>validateDriverInput({...input,...extra})).toThrow();
 for(const extra of [{port:5},{axes:[NaN,0,0,0,0,0]},{buttons:1024},{pov:23}])expect(()=>validateDriverInput({...input,controllers:[{...input.controllers[0],...extra}]})).toThrow();
});
async function client(server,token){
 const socket=new WebSocket('ws://127.0.0.1:'+server.port+'/socket');socket.binaryType='arraybuffer';const messages=[];socket.onmessage=e=>messages.push(typeof e.data==='string'?JSON.parse(e.data):e.data);
 await new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no;});socket.send(JSON.stringify({type:'hello',token,revision:'revision',session:server.session}));
 const wait=async predicate=>{for(let i=0;i<100;i++){const m=messages.find(predicate);if(m)return m;await Bun.sleep(10);}throw Error('Expected socket response');};
 return {socket,messages,wait,send:x=>socket.send(JSON.stringify(x))};
}
test('state server authorizes one robot, coalesces snapshots, disables stale/disconnected inputs and rejects spectators',async()=>{
 const calls=[],snapshot={tick:0,time:0,bodies:{body:body()}},coordinator={snapshot,failure:null};
 const assets={manifest:{schema:1,revision:'revision',assetRoot:'/assets/revision',bodyIds:['body'],robots:[{id:'r0',prefix:'r0/'},{id:'r1',prefix:'r1/'}]},read:async()=>null};
 const server=await startMatchServer({coordinator,assets,inputTimeoutMs:100,stateHz:60,sendControls:async(id,c)=>calls.push({id,...c}),clientFiles:{html:'test',js:''}}),clients=[];
 try{
  expect((await fetch('http://127.0.0.1:'+server.port+'/manifest')).status).toBe(401);
  expect((await fetch('http://127.0.0.1:'+server.port+'/manifest',{headers:{Authorization:'Bearer '+server.spectatorToken}})).status).toBe(200);
  const a=await client(server,server.driverTokens.r0);clients.push(a);await a.wait(m=>m.type==='welcome');const initial=await a.wait(m=>m instanceof ArrayBuffer);const p=new AuthoritativePoses(['body']);p.accept(initial);expect(p.bodies.body.position[0]).toBe(0);
  a.send({type:'input',sequence:1,enabled:true,controllers:[]});await Bun.sleep(30);expect(calls.at(-1).id).toBe('r0');expect(calls.at(-1).mode).toBe('teleop');expect(snapshot.bodies.body.position[0]).toBe(0);
  coordinator.snapshot={tick:9,time:.045,bodies:{body:body(5)}};const update=await a.wait(m=>m instanceof ArrayBuffer&&new DataView(m).getFloat64(16,true)===9);p.accept(update);expect(p.bodies.body.position[0]).toBe(5);
  await a.wait(m=>m.type==='disabled');expect(calls.at(-1).mode).toBe('disabled');a.send({type:'input',sequence:2,enabled:true,controllers:[]});await Bun.sleep(30);expect(calls.at(-1).mode).toBe('disabled');
  a.send({type:'input',sequence:3,enabled:false,controllers:[]});a.send({type:'input',sequence:4,enabled:true,controllers:[]});await Bun.sleep(20);expect(calls.at(-1).mode).toBe('teleop');
  const duplicate=await client(server,server.driverTokens.r0);clients.push(duplicate);expect((await duplicate.wait(m=>m.type==='error')).message).toContain('already');
  a.socket.close();await Bun.sleep(30);expect(calls.at(-1).mode).toBe('disabled');
  const spectator=await client(server,server.spectatorToken);clients.push(spectator);await spectator.wait(m=>m.type==='welcome');spectator.send({type:'input',sequence:1,enabled:true,controllers:[]});expect((await spectator.wait(m=>m.type==='error')).message).toContain('cannot drive');
  expect(calls.every(c=>c.id==='r0')).toBe(true);
 }finally{for(const c of clients)c.socket.close();await server.close();}
});

test('preloaded assets have immutable revisions and fail closed when source bytes change',async()=>{
 const {matchFixture}=await import('./match-fixture.js'),{rm,writeFile}=await import('node:fs/promises'),f=await matchFixture();
 try{
  expect(f.assets.manifest.prediction).toBe(false);expect(f.assets.manifest.revision).toMatch(/^[a-f0-9]{64}$/);expect(await f.assets.read('../bindings.json')).toBeNull();
  const original=await f.assets.read('robot/mesh.bin');expect(original.length).toBeGreaterThan(10);await writeFile(f.root+'/robot/mesh.bin','changed');await expect(f.assets.read('robot/mesh.bin')).rejects.toThrow('changed');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('six viewers share an encoded update and a same-tick resync preserves every decoder base',async()=>{
 const coordinator={snapshot:{tick:0,time:0,bodies:{body:body()}},failure:null};
 const assets={manifest:{schema:1,revision:'revision',assetRoot:'/assets/revision',bodyIds:['body'],robots:[]},read:async()=>null};
 const server=await startMatchServer({coordinator,assets,stateHz:60,sendControls:async()=>{},clientFiles:{html:'test',js:''}}),clients=[];
 const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await Bun.sleep(10);}throw Error('Expected shared update');};
 const drain=c=>{for(const m of c.messages.splice(0))if(m instanceof ArrayBuffer){c.decoder.accept(m);c.last=m;}};
 try{
  for(let i=0;i<6;i++){const c=await client(server,server.spectatorToken);c.decoder=new AuthoritativePoses(['body']);clients.push(c);await c.wait(m=>m.type==='welcome');}
  await wait(()=>clients.every(c=>c.messages.some(m=>m instanceof ArrayBuffer)));for(const c of clients)drain(c);
  const encodedBefore=server.stats.poseEncodes,sentBefore=server.stats.frames;
  coordinator.snapshot={tick:1,time:.02,bodies:{body:body(3)}};
  await wait(()=>clients.every(c=>c.messages.some(m=>m instanceof ArrayBuffer&&new DataView(m).getFloat64(16,true)===1)));
  for(const c of clients)drain(c);
  expect(server.stats.poseEncodes-encodedBefore).toBe(1);expect(server.stats.frames-sentBefore).toBe(6);
  for(const c of clients){expect(c.decoder.bodies.body.position[0]).toBe(3);expect(new Uint8Array(c.last)).toEqual(new Uint8Array(clients[0].last));}
  const sequence=clients[0].decoder.sequence;
  clients[0].send({type:'resync'});
  await wait(()=>clients.every(c=>c.messages.some(m=>m instanceof ArrayBuffer&&new DataView(m).getUint32(4,true)>sequence)));
  for(const c of clients)drain(c);
  expect(new DataView(clients[0].last).getUint32(12,true)).toBe(1);
  for(const c of clients.slice(1)){expect(new DataView(c.last).getUint32(12,true)).toBe(0);expect(new DataView(c.last).getUint32(32,true)).toBe(0);}
  expect(new Set(clients.map(c=>c.decoder.sequence)).size).toBe(1);
  const beforeNext=server.stats.poseEncodes;
  coordinator.snapshot={tick:2,time:.04,bodies:{body:body(7)}};
  await wait(()=>clients.every(c=>c.messages.some(m=>m instanceof ArrayBuffer&&new DataView(m).getFloat64(16,true)===2)));
  for(const c of clients){drain(c);expect(c.decoder.bodies.body.position[0]).toBe(7);}
  expect(server.stats.poseEncodes-beforeNext).toBe(1);
 }finally{for(const c of clients)c.socket.close();await server.close();}
});

test('wall-clock corrections do not expire active driver input',async()=>{
 const calls=[],coordinator={snapshot:{tick:0,time:0,bodies:{body:body()}}};
 const assets={manifest:{revision:'revision',bodyIds:['body'],robots:[{id:'r0',prefix:'r0/'}]},read:async()=>null};
 const server=await startMatchServer({coordinator,assets,inputTimeoutMs:1000,sendControls:async(id,c)=>calls.push(c),clientFiles:{html:'test',js:''}});
 const wallClock=Date.now;let c;
 try{
  c=await client(server,server.driverTokens.r0);await c.wait(m=>m.type==='welcome');
  c.send({type:'input',sequence:1,enabled:true,controllers:[]});await Bun.sleep(30);expect(calls.at(-1).mode).toBe('teleop');
  Date.now=()=>wallClock()+60000;
  coordinator.snapshot={tick:1,time:.02,bodies:{body:body(1)}};
  await c.wait(m=>m instanceof ArrayBuffer&&new DataView(m).getFloat64(16,true)===1);
  expect(calls.at(-1).mode).toBe('teleop');expect(c.messages.some(m=>m.type==='disabled')).toBe(false);
 }finally{Date.now=wallClock;c?.socket.close();await server.close();}
});
