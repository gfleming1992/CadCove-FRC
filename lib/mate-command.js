// Headless assembly solves, with an optional live-canvas playback path.
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {mechanismSolverRequest} from '../vendor/cad-core/src/core/mechanism-solver.js';
import {validateMechanism,resolveJoint} from '../vendor/cad-core/src/core/mechanism.js';
import {mechanismPreview,assertPreviewFresh} from './mechanism-preview.js';
import {connectEditor} from './mcp-proxy.js';
import {bundledRuntime,runtimeRoot} from './runtime-location.js';

// Preserve every uncommanded independent coordinate. Coupled followers are
// solved from their driver, never added as duplicate independent drives.
export function motionFromPose(definition,motion,state){
 const m=validateMechanism(definition);
 if(!state||!state.angles)throw Error('Canvas did not provide a joint pose');
 if(state.running)throw Error('Pause or stop the current motion before solving a new trajectory');
 if(!Array.isArray(motion?.drives)||!motion.drives.length)throw Error('Provide at least one motion drive');
 const incoming=new Map(m.relations.map(r=>[r.follower,r.driver]));
 const root=id=>{while(incoming.has(id))id=incoming.get(id);return id;};
 const commanded=new Set(),drives=motion.drives.map(d=>{
  if(!d||typeof d.joint!=='string')throw Error('Each motion drive needs a joint ID');
  const id=resolveJoint(m,d.joint);commanded.add(root(id));
  if(!Number.isFinite(state.angles?.[id]))throw Error('Canvas is missing current joint angle: '+id);
  return {...d,position:d.position??state.angles[id]};
 });
 for(const j of m.joints)if(!incoming.has(j.id)&&!commanded.has(j.id)){
  if(!Number.isFinite(state.angles?.[j.id]))throw Error('Canvas is missing current joint angle: '+j.id);
  drives.push({joint:j.id,position:state.angles[j.id]});
 }
 return {...motion,drives};
}

async function animateMechanism(options){
 if(!options.input||!options.output)throw Error('animate requires --input MOTION.json and --output NEW_SOLUTION.json');
 const workspace=await fs.realpath(path.resolve(options.workspace??process.cwd())),target=options.target??'cad';
 if(!['cad','field'].includes(target))throw Error('Choose --target cad or field');
 const output=path.resolve(options.output),parent=await fs.realpath(path.dirname(output)),relative=path.relative(workspace,path.join(parent,path.basename(output)));
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Animation solution output must be inside the workspace');
 try{await fs.lstat(output);throw Error('Animation output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const descriptor=await mechanismPreview(workspace),motion=JSON.parse(await fs.readFile(path.resolve(options.input),'utf8'));
 const client=await connectEditor(workspace);
 const canvas=async(action,args={})=>{
  const r=await client.callTool({name:'canvas_command',arguments:{workspace,target,entry:target==='cad'?descriptor.entry:undefined,action,options:args}},undefined,{timeout:90000});
  const text=r.content?.find(c=>c.type==='text')?.text;if(r.isError)throw Error(text??'Canvas command failed');return JSON.parse(text);
 };
 let temp;
 try{
  const caps=await canvas('capabilities');if(!caps.motion||caps.mode!=='cad')throw Error('Return to CAD preview mode before requesting solver animation');
  const before=await canvas('motion',{action:'state'}),planned=motionFromPose(descriptor.definition,motion,before);
  const request=mechanismSolverRequest(descriptor.definition,planned,descriptor.sourceRevision);
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-live-solve-'));
  const input=path.join(temp,'request.json');await fs.writeFile(input,JSON.stringify(request));
  const solved=await mateCommand({...options,action:'solve',input,output});
  await assertPreviewFresh(descriptor);
  const after=await canvas('motion',{action:'state'});
  if(after.running||Object.entries(before.angles).some(([id,v])=>Math.abs(v-after.angles?.[id])>1e-8||!Number.isFinite(after.angles?.[id])))throw Error('Canvas pose changed during solve; solution saved but not played');
  const playback=await canvas('motion',{action:'play-solved',solutionFile:relative});
  return {ok:true,solver:'OndselSolver',sourceRevision:descriptor.sourceRevision,target,output,frames:solved.frames,playback,noGeometryBuild:true};
 }finally{await client.close();if(temp)await fs.rm(temp,{recursive:true,force:true});}
}
export async function mateCommand(options){
 const action=options.action??'capabilities';
 if(action==='animate')return animateMechanism(options);
 if(action==='inspect-step'){
  if(!options.input||!options.output)throw Error('inspect-step requires --input STEP_FILE and --output NEW_REPORT.json');
  const script=path.join(runtimeRoot,...(bundledRuntime?['step_kinematics.py']:['vendor','cad-core','src','native','step_kinematics.py']));
  const p=Bun.spawn([options.python??process.env.CADCOVE_STEP_PYTHON??process.env.CADCOVE_PYTHON??'python3',script,'--input',path.resolve(options.input),'--output',path.resolve(options.output)],{stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>p.kill(),60000);
  try{
   const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
   const line=stdout.split('\n').findLast(s=>s.startsWith('{"ok":'));
   if(!line)throw Error('STEP inspection returned no structured result: '+stderr.slice(-4000));
   const result=JSON.parse(line);if(code||!result.ok)throw Error(result.error??stderr.slice(-4000));return result;
  }finally{clearTimeout(timer);}
 }
 if(action==='capabilities')return {ok:true,experimental:true,solver:'OndselSolver',configured:!!(options.solver??process.env.CADCOVE_MATE_SOLVER),commands:['capabilities','solve','solve-mechanism','animate','inspect-step'],liveAnimation:{targets:['cad','field'],preservesCurrentPose:true,rebuildsGeometry:false},stepInspection:{requires:'OCP.StepKinematics',automaticSolverMapping:false},units:'mm-deg-s',mates:['fixed','revolute','slider'],couplings:['gear','belt','chain'],couplingScope:'parallel shafts on a common carrier; driven acyclic chains',continuousPulleyBindings:true,drives:['position','velocity','acceleration','jerk'],closedLoops:true,collisionChecking:false,automaticMateInference:false,physics:false};
 if(action==='solve-mechanism'){
  if(!options.input||!options.output)throw Error('solve-mechanism requires --input and --output');
  const value=JSON.parse(await fs.readFile(path.resolve(options.input),'utf8'));
  if(Object.keys(value).some(k=>!['mechanism','motion','sourceRevision'].includes(k)))throw Error('Expected mechanism, motion, sourceRevision');
  const request=mechanismSolverRequest(value.mechanism,value.motion,value.sourceRevision),temp=await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-mates-'));
  try{const input=path.join(temp,'request.json');await fs.writeFile(input,JSON.stringify(request));return await mateCommand({...options,action:'solve',input});}
  finally{await fs.rm(temp,{recursive:true,force:true});}
 }
 if(action!=='solve'||!options.input||!options.output)throw Error('Use cad-mates --action solve --input REQUEST.json --output NEW_RESULT.json');
 const script=path.join(runtimeRoot,...(bundledRuntime?['mate-solver.py']:['vendor','cad-core','src','native','ondsel','solver.py']));
 const args=[options.python??process.env.CADCOVE_PYTHON??'python3',script,'--input',path.resolve(options.input),'--output',path.resolve(options.output)];
 if(bundledRuntime)args.push('--pin',path.join(runtimeRoot,'ondsel-upstream.json'));
 if(options.solver)args.push('--solver',path.resolve(options.solver));
 const p=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>p.kill(),65000);
 try{
  const [stdout,stderr,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  let result;try{result=JSON.parse(stdout.trim());}catch{throw Error('Mate solver returned no structured result: '+stderr.slice(-4000));}
  if(code||!result.ok)throw Error(result.error??stderr.slice(-4000));return result;
 }finally{clearTimeout(timer);}
}
