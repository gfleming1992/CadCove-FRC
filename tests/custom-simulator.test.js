import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {nativeExecutable,validateCustomSimulator,requireMechanismCapabilities} from '../lib/runtime-location.js';
import {buildCustomSimulator} from '../lib/custom-simulator.js';

test('project custom engine is explicit, project-local and overrides legacy environment',()=>{
 const project={build:path.join(os.tmpdir(),'team build'),profile:{runtime:{customSimulator:{sourceDirectory:'../source',package:'team-sim',binary:'team-sim'}}}};
 const old=process.env.INSTANTCAD_SIM_BINARY;process.env.INSTANTCAD_SIM_BINARY='/wrong/engine';
 try{expect(nativeExecutable(project)).toBe(path.join(project.build,'custom-simulator','release','team-sim'+(process.platform==='win32'?'.exe':'')));
 expect(nativeExecutable()).toBe(path.resolve('/wrong/engine'));}finally{if(old===undefined)delete process.env.INSTANTCAD_SIM_BINARY;else process.env.INSTANTCAD_SIM_BINARY=old;}
 for(const change of [{binary:'../escape'},{package:'--help'},{features:['a,b']},{typo:true},{sourceDirectory:''}])
  expect(()=>validateCustomSimulator({...project.profile.runtime.customSimulator,...change})).toThrow();
});

test('build selected Rust source in a path with spaces; failure removes stale executable',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cadcove custom '));
 try{
  const source=path.join(root,'source');await mkdir(path.join(source,'src'),{recursive:true});
  await writeFile(path.join(source,'Cargo.toml'),'[package]\nname="team-sim"\nversion="0.1.0"\nedition="2021"\n[workspace]\n');
  await writeFile(path.join(source,'Cargo.lock'),'version = 4\n[[package]]\nname="team-sim"\nversion="0.1.0"\n');
  await writeFile(path.join(source,'src/main.rs'),'fn main() { println!("team physics"); }');
  const project={root,build:path.join(root,'build'),profile:{runtime:{customSimulator:{sourceDirectory:'source',package:'team-sim',binary:'team-sim'}}}};
  await mkdir(path.join(project.build,'.cadcove-session-lock'),{recursive:true});
  await expect(buildCustomSimulator(project,{onOutput:()=>{}})).rejects.toThrow('Stop simulation');
  await rm(path.join(project.build,'.cadcove-session-lock'),{recursive:true});
  const result=await buildCustomSimulator(project,{onOutput:()=>{}});
  expect(result.ok).toBe(true);expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(await readFile(result.executable+'.build.json','utf8')).sha256).toBe(result.sha256);
  await writeFile(path.join(source,'src/main.rs'),'not valid rust');
  await expect(buildCustomSimulator(project,{onOutput:()=>{}})).rejects.toThrow('failed');
  await expect(access(result.executable)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

test('old or wrong native binaries cannot silently ignore custom mechanism data',()=>{
 const selected=[{id:'drag',kind:'team.drag-v1'}];
 for(const info of [{ok:true},{features:['custom-mechanisms-v1'],mechanisms:[]},{features:[],mechanisms:['team.drag-v1']}])
  expect(()=>requireMechanismCapabilities(info,selected)).toThrow('lacks');
 expect(()=>requireMechanismCapabilities({features:['custom-mechanisms-v1'],mechanisms:['team.drag-v1']},selected)).not.toThrow();
 expect(()=>requireMechanismCapabilities({},[])).not.toThrow();
 expect(()=>requireMechanismCapabilities({},undefined)).not.toThrow();
});
