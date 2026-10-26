import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {resolveSubsystem,indexAssemblyTrees} from './subsystem-model.js';
import {cadProjectSettings} from './cad-project.js';
import {cadFeedback} from './cad-feedback.js';
import {connectEditor} from './mcp-proxy.js';
async function readInside(root,name,{revision=false}={}){
 if(typeof name!=='string'||!name.trim())throw Error('Subsystem input needs a workspace path');
 const file=await fs.realpath(path.resolve(root,name)),rel=path.relative(root,file);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Subsystem input must be inside workspace');
 if((await fs.stat(file)).size>32*1024*1024)throw Error('Subsystem input exceeds 32 MiB');const text=await fs.readFile(file,'utf8'),value=JSON.parse(text);return revision?{value,revision:createHash('sha256').update(text).digest('hex')}:value;
}
export async function subsystemCommand(options){
 const root=await fs.realpath(path.resolve(options.workspace??process.cwd())),manifest=await readInside(root,options.manifest??'config/subsystems.json'),action=options.action??'list';
 if(manifest?.schema!==1||!Array.isArray(manifest.subsystems))throw Error('Unsupported subsystem manifest schema');
 const subsystemIds=new Set();for(const s of manifest.subsystems){if(!s||typeof s.id!=='string'||!s.id.trim()||subsystemIds.has(s.id))throw Error('Invalid or duplicate subsystem ID');subsystemIds.add(s.id);}
 const visited=new Set(),active=new Set(),byId=new Map(manifest.subsystems.map(s=>[s.id,s]));
 function checkDependencies(id){if(active.has(id))throw Error('Subsystem dependency cycle: '+id);if(visited.has(id))return;active.add(id);const deps=byId.get(id).dependencies??[];if(!Array.isArray(deps))throw Error('Subsystem dependencies must be an array');for(const dep of deps){if(!subsystemIds.has(dep))throw Error('Unknown subsystem dependency: '+dep);checkDependencies(dep);}active.delete(id);visited.add(id);}for(const id of subsystemIds)checkDependencies(id);
 if(action==='list')return {ok:true,subsystems:manifest.subsystems.map(s=>({id:s.id,name:s.name,dependencies:s.dependencies??[]}))};
 if(!['inspect','show','validate'].includes(action)||!options.id)throw Error('Use subsystem list or inspect/show/validate with --id');
 const config=await cadProjectSettings(root),entry=options.entry??config.entryPoint;
 const feedback=await cadFeedback(root,{entry});if(!feedback.ok)throw Error('Build current CAD before resolving a subsystem');
 const trees=[];for(const t of manifest.trees??[]){const loaded=await readInside(root,t.file,{revision:true});if(t.revision!==undefined&&t.revision!==loaded.revision)throw Error('Stale subsystem tree descriptor revision: '+t.id);trees.push({...t,root:loaded.value,revision:loaded.revision});}
 const indexed=indexAssemblyTrees(trees),additional=feedback.parts.filter(p=>!indexed.leaves.has(p.id));
 // Current authored CAD leaves absent from a STEP tree remain explicitly visible
 // as ungrouped occurrences. This does not invent subsystem membership.
 if(additional.length)trees.push({id:'current-cad-ungrouped',kind:'cadquery',root:{id:'cadcove/ungrouped',children:additional.map(p=>({id:p.id,name:p.name}))}});
 const mechanism=await readInside(root,path.join(config.sourceDirectory,path.dirname(entry),'mechanism.json'));
 let materials={};for(const file of ['config/cad-materials.json','config/game-piece-materials.json'])try{const m=await readInside(root,file);Object.assign(materials,m.materials??m.gamePieces??m);}catch(e){if(e.code!=='ENOENT')throw e;}
 const resolved=resolveSubsystem(manifest,options.id,{trees,mechanism,parts:feedback.parts,sourceRevision:feedback.sourceRevision,materials});
 if(action==='validate')return {ok:resolved.physics.complete,...resolved};
 if(action==='show'){
  const client=await connectEditor(root);try{
   for(const [action,params]of [['visibility',{action:'isolate',ids:resolved.occurrenceIds}],['view',{ids:resolved.occurrenceIds,view:'iso'}]]){
    const r=await client.callTool({name:'canvas_command',arguments:{workspace:root,entry,action,options:params}},undefined,{timeout:60000});if(r.isError)throw Error(r.content.find(c=>c.type==='text')?.text??'Subsystem canvas request failed');
   }
  }finally{await client.close();}
 }
 return {ok:true,...resolved,displayOnly:action==='show'};
}
