// Small integration smoke test: run the real robot/CTRE bridge, drive briefly,
// and shut down. The prepared example's Driver Station profile stays unchanged.
import path from 'node:path';
import {readFile,writeFile,rm} from 'node:fs/promises';
const [projectArg]=process.argv.slice(2);if(!projectArg||process.argv.length!==3)throw Error('Usage: bun scripts/verify-team-example.js PREPARED_WORKSPACE/robot.sim.json');
const project=path.resolve(projectArg),workspace=path.dirname(project),repo=path.resolve(import.meta.dir,'..');
const testProject=path.join(workspace,'example-smoke.sim.json'),input=path.join(workspace,'build/cadcove/example-smoke-input.json');
const profile=JSON.parse(await readFile(project));profile.runtime.controlSource='agent';delete profile.runtime.driverStation;
await writeFile(testProject,JSON.stringify(profile));
const cli=[process.execPath,path.join(repo,'bin/cadcove.js')],env=process.env;
async function command(name,body){if(body)await writeFile(input,JSON.stringify(body));const p=Bun.spawn([...cli,name,'--project',testProject,...(body?['--input',input]:[])],{cwd:workspace,env,stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw Error(name+': '+out+err);return JSON.parse(out);}
const child=Bun.spawn([...cli,'sim-run','--project',testProject],{cwd:workspace,env,stdout:'pipe',stderr:'pipe'});
const events=[],log=new Response(child.stderr).text();let partial='',ended=false;
const reader=(async()=>{for await(const bytes of child.stdout){partial+=new TextDecoder().decode(bytes);let i;while((i=partial.indexOf('\n'))>=0){const line=partial.slice(0,i);partial=partial.slice(i+1);if(line.trim())events.push(JSON.parse(line));}}})();
child.exited.then(()=>ended=true);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const deadline=Date.now()+(process.platform==='win32'?180000:45000);while(!ended&&!events.some(e=>e.event==='simulation-ready')&&Date.now()<deadline)await sleep(100);
 if(!events.some(e=>e.event==='simulation-ready'))throw Error('Robot did not start: '+JSON.stringify(events)+(ended?await log:''));
 const before=(await command('sim-state')).result;let after=before;
 for(let i=0;i<20;i++){await command('sim-controls',{mode:'teleop',controllers:[{port:1,axes:[0,-.5,0,0,0,0],buttons:0,pov:-1}]});await sleep(100);after=(await command('sim-state')).result;if(after.error)throw Error(after.error);}
 await command('sim-controls',{mode:'disabled',controllers:[]});
 const a=before.state.bodies.chassis.position,b=after.state.bodies.chassis.position,travel=Math.hypot(b[0]-a[0],b[1]-a[1]);
 if(after.state.tick<=before.state.tick||travel<.02)throw Error('Robot did not drive through the vendor bridge: '+JSON.stringify({travel,before:before.state.tick,after:after.state.tick}));
 const report={ok:true,example:'team3310-rebuilt',worldHash:after.worldHash,ticks:after.state.tick-before.state.tick,travelMetres:travel,robotMotors:Object.keys(after.state.motors).length,hardwareQualified:false};
 await writeFile(path.join(workspace,'build/cadcove/example-smoke.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
 if(!ended)await command('sim-stop').catch(()=>child.kill());
 await Promise.race([child.exited,sleep(5000)]);if(!ended)child.kill();await reader;await log;
 await rm(testProject,{force:true});await rm(input,{force:true});
}
