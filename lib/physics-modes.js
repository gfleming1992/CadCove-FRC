// A mode is compiled into a separate immutable world/build. The detailed source
// stays available for offline robot-code checks; switching never reuses state.
import path from 'node:path';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {readRobotProject,auditRobotProject,hash} from './robot-project.js';
export const physicsModeNames=['accurate','gameplay'];
const allowedSettings=new Set(['dt','soft_contact_max_angle_rad','solver_iterations','solver_schedule','max_contact_substeps','local_cylinder_contacts','gameplay','fieldFoamSubdivisions']);
export function physicsModeWorld(source,mode,gameplaySettings){
 if(!physicsModeNames.includes(mode))throw Error('Unknown physics mode: '+mode);
 if(source.gameplay)throw Error('Build modes from a detailed source world, not a gameplay approximation');
 const world=structuredClone(source);
 if(mode==='gameplay'){
  if(!gameplaySettings)throw Error('A measured gameplay recipe is required');
  for(const name of Object.keys(gameplaySettings))if(!allowedSettings.has(name))throw Error('Unsupported gameplay setting: '+name);
  const {fieldFoamSubdivisions,...settings}=structuredClone(gameplaySettings);
  if(fieldFoamSubdivisions!==undefined&&(!Number.isInteger(fieldFoamSubdivisions)||fieldFoamSubdivisions<0||fieldFoamSubdivisions>2||!settings.gameplay?.field_compliance))throw Error("Field foam resolution requires explicit field compliance and subdivisions 0–2");
  if(settings.solver_schedule!==undefined&&!['per_refresh','per_tick'].includes(settings.solver_schedule))throw Error('Unknown solver schedule');
  if(settings.max_contact_substeps!==undefined&&(!Number.isInteger(settings.max_contact_substeps)||settings.max_contact_substeps<1||settings.max_contact_substeps>64))throw Error('max_contact_substeps must be an integer in 1..64');
  if(settings.local_cylinder_contacts!==undefined&&typeof settings.local_cylinder_contacts!=='boolean')throw Error('local_cylinder_contacts must be boolean');
  Object.assign(world,settings);
  if(world.gameplay){
   const balls=new Set(world.gameplay.balls);
   // Robot compliance retains authored materials and moving activation zones;
   // native validation checks passive storage and physical pickup regions.
   if(world.gameplay.field_compliance&&world.gameplay.robot_compliance)throw Error("Choose field or robot compliance, not both");
   if(world.gameplay.field_compliance){
    // Hub rollers squeeze foam. Preserve only authored fixed-field activation
    // regions, keeping the expensive robot-mechanism zones out of practice.
    const fixed=new Set(world.bodies.filter(b=>b.fixed).map(b=>b.id));
    world.compliance_zones=(world.compliance_zones||[]).filter(z=>fixed.has(z.body));
    if(!world.compliance_zones.length)throw Error('Field compliance needs authored fixed-field zones');
    if(fieldFoamSubdivisions!==undefined)for(const body of world.bodies)if(body.compliance)body.compliance.subdivisions=fieldFoamSubdivisions;
   }else if(!world.gameplay.robot_compliance){
    for(const body of world.bodies)if(balls.has(body.id))delete body.compliance;
    world.compliance_zones=[];
   }
  }
 }
 return world;
}

// Generic installed-CLI path. Recipes supply all mechanism/field assumptions;
// no team-specific hub geometry or developer scripts enter the runtime.
export async function createPhysicsMode({project,mode,output,recipeFile}){
 if(!project||!output||!physicsModeNames.includes(mode))throw Error('sim-mode requires --project, --mode accurate|gameplay, and --output NEW_DIRECTORY');
 const source=await readRobotProject(project),audit=await auditRobotProject(source);
 if(!audit.canLoad)throw Error('Source project audit failed: '+audit.errors.join('; '));
 if(source.profile.physicsMode?.name==='gameplay')throw Error('Build modes from the original detailed project');
 const bytes=await readFile(path.join(source.build,'world.json')),sourceWorldHash=hash(bytes);
 const recipe=recipeFile?JSON.parse(await readFile(recipeFile,'utf8')):null;
 if(mode==='accurate'&&recipe)throw Error('Accurate mode preserves source bytes and does not accept a recipe');
 if(mode==='gameplay'&&(!recipe?.settings||!recipe.description?.trim()||!recipe.evidence?.trim()||recipe.sourceWorldHash!==sourceWorldHash))throw Error('Gameplay requires a recipe with matching sourceWorldHash, settings, description and evidence');
 const world=physicsModeWorld(JSON.parse(bytes),mode,recipe?.settings);
 const resultBytes=mode==='accurate'?bytes:Buffer.from(JSON.stringify(world)),worldHash=hash(resultBytes);
 const out=path.resolve(output),relative=p=>path.relative(out,p).split(path.sep).join('/')||'.';
 const runtime={...source.profile.runtime};
 for(const key of ['project','jar','nativeLibraries','jdk','assetRoot']){
  const value=source.profile.runtime[key];
  if(value!==undefined)runtime[key]=relative(path.resolve(source.root,value));
 }
 if(runtime.customSimulator)runtime.customSimulator={...runtime.customSimulator,sourceDirectory:relative(path.resolve(source.root,runtime.customSimulator.sourceDirectory))};
 runtime.assetRoot=relative(path.resolve(source.root,source.profile.runtime.assetRoot??'.'));
 const physicsMode={name:mode,sourceProject:relative(source.profilePath),sourceWorldHash,worldHash,
  description:mode==='accurate'?'Original detailed world; hardware calibration remains required':recipe.description,
  settings:mode==='accurate'?{}:recipe.settings,evidence:mode==='accurate'?'Original world bytes preserved':recipe.evidence};
 const profile={...source.profile,id:source.profile.id+'-'+mode,name:source.profile.name+' — '+mode,
  build:'.',cad:Object.fromEntries(Object.entries(source.cad).map(([k,v])=>[k,relative(v)])),runtime,physicsMode};
 const scene=JSON.parse(await readFile(path.join(source.build,'scene-bindings.json'),'utf8'));
 let scenario;try{scenario=JSON.parse(await readFile(path.join(source.build,'scenario.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(out); // Exclusive creation: never replace a prior build or session.
 try{
  await writeFile(path.join(out,'world.json'),resultBytes,{flag:'wx'});
  await writeFile(path.join(out,'scene-bindings.json'),JSON.stringify({...scene,worldHash}),{flag:'wx'});
  if(scenario)await writeFile(path.join(out,'scenario.json'),JSON.stringify({...scenario,worldHash}),{flag:'wx'});
  await writeFile(path.join(out,'robot.sim.json'),JSON.stringify(profile,null,2)+'\n',{flag:'wx'});
  const check=await auditRobotProject(await readRobotProject(path.join(out,'robot.sim.json')));
  if(!check.canLoad)throw Error('Generated mode audit failed: '+check.errors.join('; '));
  return {schema:1,ok:true,command:'sim-mode',project:path.join(out,'robot.sim.json'),physicsMode,qualification:'artifact-audit-only',next:'Run sim-validate, then start a fresh sim-run for this project. No live session was changed.'};
 }catch(e){await rm(out,{recursive:true,force:true});throw e;}
}
