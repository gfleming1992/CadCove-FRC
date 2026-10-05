import {test,expect,afterEach} from 'bun:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {viewerRequest} from '../lib/viewer-client.js';
const roots=[],servers=[];afterEach(async()=>{for(const s of servers.splice(0))s.stop(true);for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function setup(fetch){const build=await mkdtemp(path.join(os.tmpdir(),'cadcove-viewer-'));roots.push(build);const project={build,profilePath:path.join(build,'robot.sim.json')};await writeFile(project.profilePath,'{}');const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch});servers.push(server);const record={schema:1,project:project.profilePath,endpoint:server.url.origin,token:'a'.repeat(64)},file=path.join(build,'cadcove-viewer.json');const save=()=>writeFile(file,JSON.stringify(record));await save();return {project,record,save};}
test('viewer requests use private auth and fail for rejected or stale/redirected endpoints',async()=>{
 let response=()=>Response.json({ok:true,image:'/local/preview.png'}),request;
 const f=await setup(r=>{request={auth:r.headers.get('authorization'),url:r.url};return response();});expect((await viewerRequest(f.project,'capture',{scope:'robot'})).ok).toBe(true);expect(request.auth).toBe('Bearer '+f.record.token);expect(new URL(request.url).pathname).toBe('/capture');
 response=()=>Response.json({ok:false,error:'Simulation changed during capture'},{status:400});await expect(viewerRequest(f.project,'capture')).rejects.toThrow('Simulation changed');
 response=()=>Response.redirect('http://127.0.0.1:1');await expect(viewerRequest(f.project,'state')).rejects.toThrow();
});
test('viewer lookup rejects remote URLs and another project before sending requests',async()=>{
 let calls=0;const f=await setup(()=>{calls++;return Response.json({ok:true});});
 f.record.endpoint='https://example.com';await f.save();await expect(viewerRequest(f.project,'state')).rejects.toThrow('does not belong');
 f.record.endpoint='http://127.0.0.1:1';f.record.project=path.join(f.project.build,'other.json');await writeFile(f.record.project,'{}');await f.save();await expect(viewerRequest(f.project,'state')).rejects.toThrow('does not belong');expect(calls).toBe(0);
});
