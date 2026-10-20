import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,rename,rm,open} from 'node:fs/promises';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const guidanceStateFile='.cadcove/guidance-state.json';
export const agentEntrypoints=['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'];
const start='<!-- cadcove:instructions:start -->',end='<!-- cadcove:instructions:end -->';
// Root files belong to the team. Add a small discovery block once, but never
// replace existing instructions or adopt the whole file as managed content.
export async function agentEntrypointChanges(root){
 const changes=[];
 for(const file of agentEntrypoints){
  const previous=await text(await safe(root,file));
  const starts=previous?.split(start).length-1||0,ends=previous?.split(end).length-1||0;
  if(starts!==ends||starts>1||(starts&&previous.indexOf(end)<previous.indexOf(start)))throw Error('Incomplete or duplicate CadCove instruction block in '+file);
  const legacy=`${start}\nFor CAD, robot integration, simulation and practice tasks, read \`.cadcove/AGENT.md\` from the workspace root first.\n${end}\n`;
  const previousBlock=`${start}\nCadCove MCP is the first interface for CAD/simulation requests. For "open robot CAD", call \`open_robot_cad\` immediately; do not read package.json, scan the repository, or start physics first. The VS Code extension starts the local MCP server automatically. If tools are absent, run **CadCove: Start MCP Server** and enable CadCove in your agent tool picker; other MCP hosts use \`cadcove mcp --workspace WORKSPACE_PATH\` as a stdio server. Call \`workspace_context\` for configuration. For authoring/integration, then read \`.cadcove/AGENT.md\` and its focused skills.\n${end}\n`;
  const block=`${start}\nCadCove MCP is the first interface for CAD/simulation requests. For "open robot CAD", call \`open_robot_cad\` immediately; do not read package.json, scan the repository, or start physics first. The VS Code extension starts the local MCP server automatically. If this chat does not expose MCP tools, run \`cadcove cad-open --workspace WORKSPACE_PATH\` immediately instead. Missing chat tools do not mean the server is stopped. Do not use the command palette or ask users to start the server unless the connection actually fails. Other MCP hosts can optionally use \`cadcove mcp --workspace WORKSPACE_PATH\` as a stdio server. Call \`workspace_context\` for configuration. For authoring/integration, then read \`.cadcove/AGENT.md\` and its focused skills.\n${end}\n`;
  if(starts){for(const owned of [legacy,previousBlock])if(previous.includes(owned)){changes.push({file,previous,content:previous.replace(owned,block)});break;}continue;}
  changes.push({file,previous,content:(previous??'')+(previous?'\n\n':'')+block});
 }
 return changes;
}
export const managedGuidanceFile=file=>file==='.cadcove/AGENT.md'||/^\.cadcove\/(skills\/[a-z0-9-]+\/SKILL\.md|skills\/references\/[a-z0-9-]+\.md|seasons\/[0-9]{4}\.json)$/.test(file);
export function guidanceState(files){return JSON.stringify({schema:1,files:Object.fromEntries([...files].filter(([file])=>managedGuidanceFile(file)).map(([file,text])=>[file,digest(text)]))},null,2)+'\n';}
async function safe(root,file){let at=root;for(const [i,part] of file.split('/').entries()){at=path.join(at,part);try{const s=await lstat(at);if(s.isSymbolicLink()||(i<file.split('/').length-1&&!s.isDirectory()))throw Error('Unsafe guidance path: '+file);}catch(e){if(e.code!=='ENOENT')throw e;}}return at;}
async function text(file){try{return await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}

// Caller supplies only maintained instruction templates, never robot/profile
// defaults. A missing baseline means legacy/custom content, not ownership.
export async function updateManagedGuidance(root,templates,{dryRun=false,entrypoints=false}={}){
 const files=new Map([...templates].filter(([file])=>managedGuidanceFile(file)));
 const statePath=await safe(root,guidanceStateFile),oldState=await text(statePath);
 const state=oldState===null?{schema:1,files:{}}:JSON.parse(oldState);
 if(state.schema!==1||!state.files||Array.isArray(state.files)||typeof state.files!=='object'||Object.entries(state.files).some(([file,hash])=>!managedGuidanceFile(file)||!/^[a-f0-9]{64}$/.test(hash)))throw Error('Invalid guidance baseline; preserve it for review instead of overwriting');
 const next={...state.files},changes=[],conflicts=[],unchanged=[];
 if(entrypoints)changes.push(...await agentEntrypointChanges(root));
 for(const [file,content] of files){
  const destination=await safe(root,file),previous=await text(destination),hash=digest(content);
  if(previous===content){next[file]=hash;unchanged.push(file);continue;}
  if((previous===null&&!Object.hasOwn(state.files,file))||(previous!==null&&state.files[file]===digest(previous))){changes.push({file,content,previous});next[file]=hash;continue;}
  const proposal=`.cadcove/guidance-updates/${hash}/${file.slice('.cadcove/'.length)}`;
  const oldProposal=await text(await safe(root,proposal));
  if(oldProposal!==null&&oldProposal!==content)throw Error('Existing guidance proposal was modified: '+proposal);
  conflicts.push({file,proposal,reason:previous===null?'locally-deleted':'locally-edited-or-legacy',content,previous:oldProposal});
 }
 const serialized=JSON.stringify({schema:1,files:next},null,2)+'\n';
 // Preflight every destination before taking a lock or creating directories.
 const lockPath=await safe(root,'.cadcove/guidance-update.lock');
 if(!dryRun){
  await mkdir(path.dirname(statePath),{recursive:true});let lock;
  try{lock=await open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')throw Error('A guidance update lock exists. Check its recorded PID before removing a stale .cadcove/guidance-update.lock.');throw e;}
  try{
   await lock.writeFile(JSON.stringify({pid:process.pid}));
   if(await text(statePath)!==oldState)throw Error('Guidance baseline changed; retry the update');
   for(const item of [...changes,...conflicts.map(c=>({...c,file:c.proposal}))]){
    if(item.previous===item.content)continue;
    const file=await safe(root,item.file);if(await text(file)!==item.previous)throw Error('Guidance changed during update: '+item.file);
    await mkdir(path.dirname(file),{recursive:true});
    if(item.previous===null)await writeFile(file,item.content,{flag:'wx'});
    else{
     const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,item.content,{flag:'wx'});if(await text(file)!==item.previous)throw Error('Concurrent guidance edit: '+item.file);await rename(tmp,file);}finally{await rm(tmp,{force:true});}
    }
   }
   if(serialized!==oldState){const tmp=statePath+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,serialized,{flag:'wx'});await rename(tmp,statePath);}finally{await rm(tmp,{force:true});}}
  }finally{await lock.close();await rm(lockPath,{force:true});}
 }
 return {schema:1,ok:conflicts.length===0,command:'guidance-update',workspace:root,dryRun,updated:changes.map(c=>c.file),unchanged,conflicts:conflicts.map(({file,proposal,reason})=>({file,proposal,reason})),retainedRetiredFiles:Object.keys(state.files).filter(file=>!files.has(file)),next:conflicts.length?'Review and merge the proposal files with team instructions. Rerun to adopt exact matches; custom merges remain protected.':'Guidance is current. Robot sources, project settings and selected season were preserved.'};
}
