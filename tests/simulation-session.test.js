import {test,expect,afterEach} from 'bun:test';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readSession,sessionFile,sessionRequest,recoverSimulation,driverStationLaunch} from '../lib/simulation-session.js';
const roots=[],servers=[];
afterEach(async()=>{for(const s of servers.splice(0))s.stop(true);for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'cadcove-session-'));roots.push(root);
 const project={root,profilePath:path.join(root,'robot.sim.json'),build:path.join(root,'build'),profile:{id:'test-robot'}};
 await mkdir(project.build);await writeFile(project.profilePath,'{}');
 const session={schema:1,owner:randomUUID(),pid:process.pid,project:project.profilePath,projectId:project.profile.id,endpoint:'http://127.0.0.1:65432',token:'a'.repeat(64),runId:randomUUID(),worldHash:'b'.repeat(64)};
 const save=()=>writeFile(sessionFile(project),JSON.stringify(session));await save();return {project,session,save};
}
test('session identity rejects other projects, nonlocal endpoints, missing process identity',async()=>{
 const {project,session,save}=await fixture();expect((await readSession(project)).runId).toBe(session.runId);
 for(const [key,value] of [['endpoint','https://example.com'],['endpoint','http://127.0.0.1:8888/other'],['projectId','other'],['token','short'],['pid',0],['owner',null]]){
  const old=session[key];session[key]=value;await save();await expect(readSession(project)).rejects.toThrow();session[key]=old;
 }
 session.project=path.join(project.root,'other.json');await writeFile(session.project,'{}');await save();await expect(readSession(project)).rejects.toThrow('does not match');
});
test('queries and controls carry current identity; stale commands fail before network',async()=>{
 const {project,session,save}=await fixture();const calls=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){calls.push({url:new URL(request.url),auth:request.headers.get('authorization'),run:request.headers.get('x-cadcove-run'),body:request.method==='POST'?await request.json():null});return Response.json({runId:session.runId,worldHash:session.worldHash});}});servers.push(server);session.endpoint=server.url.origin;await save();
 await sessionRequest(project,'objects',{query:{id:['chassis','arm'],near:[1,2,3],limit:2}});
 expect(calls[0].auth).toBe('Bearer '+session.token);expect(calls[0].run).toBe(session.runId);expect(calls[0].url.searchParams.getAll('id')).toEqual(['chassis','arm']);expect(calls[0].url.searchParams.get('near')).toBe('1,2,3');
 await sessionRequest(project,'controls',{body:{mode:'disabled'}});expect(calls[1].body).toEqual({mode:'disabled',runId:session.runId});
 await expect(sessionRequest(project,'controls',{body:{runId:randomUUID()}})).rejects.toThrow('Stale');
 await expect(sessionRequest(project,'objects',{query:{bad:'x'}})).rejects.toThrow('Unknown');expect(calls).toHaveLength(2);
});
test('responses reject changed run, redirects and failed requests',async()=>{
 const {project,session,save}=await fixture();let response=()=>Response.json({runId:randomUUID()});
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>response()});servers.push(server);session.endpoint=server.url.origin;await save();
 await expect(sessionRequest(project,'state')).rejects.toThrow('different run');
 response=()=>Response.redirect('http://127.0.0.1:1');await expect(sessionRequest(project,'state')).rejects.toThrow();
 response=()=>new Response('',{status:401});await expect(sessionRequest(project,'state')).rejects.toThrow('401');
});
async function exitedPid(){const p=spawn(process.execPath,['-e','']);await new Promise((resolve,reject)=>{p.once('exit',resolve);p.once('error',reject);});return p.pid;}
test('recovery refuses live launcher or robot and removes only a stopped owned session',async()=>{
 const {project,session,save}=await fixture(),lock=path.join(project.build,'.cadcove-session-lock');await mkdir(lock);
 const owner={schema:1,owner:session.owner,pid:process.pid,project:project.profilePath};
 const writeOwner=()=>writeFile(path.join(lock,'owner.json'),JSON.stringify(owner));await writeOwner();
 await expect(recoverSimulation(project)).rejects.toThrow('launcher is still running');await access(sessionFile(project));
 owner.pid=await exitedPid();await writeOwner();await expect(recoverSimulation(project)).rejects.toThrow('robot program is still running');
 session.pid=owner.pid;session.owner=randomUUID();await save();await expect(recoverSimulation(project)).rejects.toThrow('does not match');
 session.owner=owner.owner;await save();expect((await recoverSimulation(project)).recovered).toBe(true);
 await expect(access(lock)).rejects.toThrow();await expect(access(sessionFile(project))).rejects.toThrow();
});
test('recovery is exclusive and preserves an existing claim',async()=>{
 const {project}=await fixture(),lock=path.join(project.build,'.cadcove-session-lock');await mkdir(lock);await writeFile(path.join(lock,'recovery'),'other');
 await expect(recoverSimulation(project)).rejects.toThrow('already claimed');expect(await readFile(path.join(lock,'recovery'),'utf8')).toBe('other');
});

test('Driver Station launch selects one provider and requires its native library',async()=>{
 const {project}=await fixture();project.runtime={nativeLibraries:project.root};project.profile.runtime={};
 expect(await driverStationLaunch(project,'darwin')).toEqual({source:'agent',args:[],extensions:''});
 project.profile.runtime.controlSource='driverstation';
 await expect(driverStationLaunch(project,'darwin')).rejects.toThrow();
 await writeFile(path.join(project.root,'libhalsim_gui.dylib'),'fixture');
 expect((await driverStationLaunch(project,'darwin')).args).toEqual(['-XstartOnFirstThread']);
 project.profile.runtime.driverStation='socket';await writeFile(path.join(project.root,'halsim_ds_socket.dll'),'fixture');
 const socket=await driverStationLaunch(project,'win32');expect(socket.args).toEqual([]);expect(socket.extensions).toEndWith('halsim_ds_socket.dll');
 project.profile.runtime.driverStation='typo';await expect(driverStationLaunch(project)).rejects.toThrow('Unsupported');
});

test('live game-piece placement carries run identity and rejects stale batches',async()=>{
 const {project,session,save}=await fixture();const calls=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){calls.push({path:new URL(request.url).pathname,body:await request.json()});return Response.json({ok:true,runId:session.runId,worldHash:session.worldHash,placed:['fuel/1']});}});servers.push(server);session.endpoint=server.url.origin;await save();
 const placements=[{id:'fuel/1',position:[0.2,0,0.6],frame:'chassis'}];
 expect((await sessionRequest(project,'game-pieces',{body:{placements}})).placed).toEqual(['fuel/1']);
 expect(calls).toEqual([{path:'/game-pieces',body:{placements,runId:session.runId}}]);
 await expect(sessionRequest(project,'game-pieces',{body:{placements,runId:randomUUID()}})).rejects.toThrow('Stale');expect(calls).toHaveLength(1);
});

test('virtual hand routes bounded motion and release through the existing authenticated session',async()=>{
 const {project,session,save}=await fixture();const calls=[];
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){calls.push(await request.json());return Response.json({ok:true,runId:session.runId,worldHash:session.worldHash,manipulation:{physicalOnly:['fuel/1'],active:{}}});}});servers.push(server);session.endpoint=server.url.origin;await save();
 const command={action:'move',id:'fuel/1',position:[0,0,0.2],duration:2,max_speed:0.2,max_force:3};
 expect((await sessionRequest(project,'game-pieces',{body:{command}})).manipulation.physicalOnly).toEqual(['fuel/1']);
 await sessionRequest(project,'game-pieces',{body:{command:{action:'release',id:'fuel/1'}}});
 expect(calls).toEqual([{command,runId:session.runId},{command:{action:'release',id:'fuel/1'},runId:session.runId}]);
});
