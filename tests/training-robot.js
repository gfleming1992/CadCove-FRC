// Complete independently authored robot through the public, packaged CLI.
// Build its Java/CAD workspace first; this test never substitutes physics poses.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
const args=process.argv.slice(2),options={};
while(args.length){const k=args.shift(),v=args.shift();if(!['--project','--runtime'].includes(k)||!v||options[k])throw Error('Expected --project FILE --runtime DIRECTORY');options[k]=v;}
if(!options['--project']||!options['--runtime'])throw Error('Project and packaged runtime are required');
const project=path.resolve(options['--project']),workspace=path.dirname(project),runtime=path.resolve(options['--runtime']);
const cli=path.join(runtime,'cadcove'+(process.platform==='win32'?'.exe':''));
const profile=JSON.parse(await readFile(project,'utf8')),build=path.resolve(workspace,profile.build),evidence=path.join(build,'qualification');
assert.equal(profile.id,'training-robot','This contract uses the original teaching fixture only');
await mkdir(evidence,{recursive:true});
async function command(name,body){
 const argv=[cli,name,'--project',project];
 if(body){const f=path.join(evidence,'request.json');await writeFile(f,JSON.stringify(body));argv.push('--input',f);}
 const p=Bun.spawn(argv,{cwd:workspace,stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>p.kill(),10000);
 try{const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);assert.equal(code,0,out+'\n'+err);return JSON.parse(out);}finally{clearTimeout(timer);}
}
await command('audit');
const launcher=Bun.spawn([cli,'sim-run','--project',project],{cwd:workspace,stdout:'pipe',stderr:'pipe'});
const logPromise=new Response(launcher.stderr).text();
const events=[];let partial='',terminal=false,stdoutText='',streamError;
const stdout=(async()=>{
 for await(const chunk of launcher.stdout){
  const text=new TextDecoder().decode(chunk);stdoutText+=text;partial+=text;let n;
  while((n=partial.indexOf('\n'))>=0){
   const line=partial.slice(0,n);partial=partial.slice(n+1);
   try{if(line.trim())events.push(JSON.parse(line));}
   catch{streamError='Launcher emitted a non-JSON event line: '+line;}
  }
 }
})();
launcher.exited.then(()=>terminal=true);
let failed,report={schema:1,ok:false,hardwareQualified:false,robot:'original training robot',season:'example.training-zone'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const packet=(forward=0,turn=0,buttons=0)=>({mode:'match',controllers:[{port:0,axes:[0,-forward,0,0,turn,0],buttons,pov:-1}]});
async function until(condition,{controls,seconds=8}={}){
 const deadline=Date.now()+seconds*1000;let result;
 do{
  assert.equal(terminal,false,'Robot process exited: '+JSON.stringify(events));
  if(controls)await command('sim-controls',controls);
  result=(await command('sim-state')).result;assert.equal(result.error,'',JSON.stringify(result));
  if(condition(result))return result;await wait(100);
 }while(Date.now()<deadline);
 throw Error('Robot condition timed out: '+JSON.stringify(result));
}
try{
 const deadline=Date.now()+45000;
 while(!events.some(e=>e.event==='simulation-ready')&&!terminal&&Date.now()<deadline)await wait(50);
 assert.ok(events.some(e=>e.event==='simulation-ready'),'Managed robot did not become ready: '+JSON.stringify(events));
 const start=await until(s=>s.state.tick>10);
 report.runId=start.runId;report.worldHash=start.worldHash;
 report.devices=(await command('sim-devices')).result;
 assert.equal(Object.keys(start.state.motors).length,5);
 assert.equal(start.match.adapter,'example.training-zone');
 const vision=await until(s=>s.robot.visionTagCount>=1&&s.vision.cameras['limelight-front'].deliveredWithTags>0);
 assert.ok(vision.robot.visionLatencyMs>=39&&vision.robot.visionLatencyMs<=46,'Configured camera capture latency is preserved');
 assert.ok(vision.robot.visionAgeSeconds>=.035&&vision.robot.visionAgeSeconds<.15,'Vendor helper subtracts latency from the NT timestamp');
 assert.ok(Math.abs(vision.robot.visionPoseX-vision.state.bodies.chassis.position[0])<.5,'Vendor helper reads a plausible noisy pose');
 report.limelight={helperVersion:'1.14',tagCount:vision.robot.visionTagCount,latencyMs:vision.robot.visionLatencyMs,ageSeconds:vision.robot.visionAgeSeconds,poseX:vision.robot.visionPoseX,poseY:vision.robot.visionPoseY,deliveredWithTags:vision.vision.cameras['limelight-front'].deliveredWithTags};
 // Exercise lease expiry before the season: losing input during a match
 // correctly aborts it, and a fresh JVM is required to start another match.
 await command('sim-controls',{...packet(.2),mode:'teleop'});
 await until(s=>s.controlMode==='teleop');
 await until(s=>s.controlMode==='disabled'&&Object.values(s.state.motors).every(m=>m.voltage===0),{seconds:3});
 report.inputLeaseDisables=true;
 await command('sim-match',{action:'start',options:{}});
 const scored=await until(s=>s.match.score>=1,{controls:packet(.55,0,8)});
 assert.ok(scored.state.bodies.chassis.position[0]>=2);
 report.scoring={score:scored.match.score,position:scored.state.bodies.chassis.position,tick:scored.state.tick};
 const raised=await until(s=>s.state.joints['lift-axis'].position>.35,{controls:packet(0,0,8)});
 const metres=raised.robot.liftRotorTurns/(160/(2*Math.PI));
 assert.ok(Math.abs(metres-raised.state.joints['lift-axis'].position)<.06,'Actual Phoenix rotor feedback tracks native lift');
 assert.ok(Math.abs(raised.robot.liftEncoderTurns-raised.robot.liftRotorTurns)<1,'CANcoder linear scaling tracks motor feedback');
 report.liftRaisedMetres=raised.state.joints['lift-axis'].position;
 const q=raised.state.bodies.chassis.quaternion;
 const turned=await until(s=>Math.abs(s.state.bodies.chassis.quaternion[2]-q[2])>.05,{controls:packet(0,.5),seconds:4});
 report.turnQuaternion=turned.state.bodies.chassis.quaternion;
 const lowered=await until(s=>s.state.joints['lift-axis'].position<.08,{controls:packet(0,0,1)});
 report.liftLoweredMetres=lowered.state.joints['lift-axis'].position;
 const [qx,qy,qz,qw]=lowered.state.bodies.chassis.quaternion;
 const yaw=Math.atan2(2*(qw*qz+qx*qy),1-2*(qy*qy+qz*qz))*180/Math.PI;
 const delta=((lowered.robot.gyroYawDegrees-yaw+540)%360)-180;
 assert.ok(Number.isFinite(delta)&&Math.abs(delta)<3,'Actual Pigeon yaw tracks the native chassis');
 report.gyroErrorDegrees=delta;
 const completed=await until(s=>s.match.phase==='complete',{controls:packet(),seconds:20});
 assert.equal(completed.match.elapsed,15);assert.ok(completed.match.score>=1);
 report.completedMatch=completed.match;report.clock=completed.clock;
 assert.equal(completed.clock.mode,'physics');
 assert.ok(Number.isFinite(completed.clock.skewSeconds)&&Math.abs(completed.clock.skewSeconds)<.03,'Robot and physics clock stay aligned');
 report.ok=true;
}catch(error){failed=error;report.error=String(error.stack||error);}
finally{
 if(!terminal){try{await command('sim-stop');}catch{} }
 const timeout=setTimeout(()=>launcher.kill(),10000);
 await launcher.exited;clearTimeout(timeout);await stdout;
 if(streamError){failed??=Error(streamError);report.ok=false;report.error=String(failed);}
 if(report.ok&&!events.some(e=>e.event==='simulation-stopped'&&e.ok)){failed=Error('Missing successful simulation-stopped event');report.ok=false;report.error=String(failed);}
 await writeFile(path.join(evidence,'robot.log'),await logPromise);
 await writeFile(path.join(evidence,'launcher.log'),stdoutText);
 await writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2)+'\n');
}
assert.equal(await access(path.join(build,'.cadcove-session-lock')).then(()=>true,()=>false),false,'Launcher cleans owned session lock');
console.log(JSON.stringify(report,null,2));if(failed)throw failed;
