import {test,expect} from 'bun:test';
import {mkdtemp,readFile,writeFile,rm,mkdir,readdir,symlink,rename} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {initializeToolbox,updateToolboxGuidance} from '../lib/toolbox-project.js';
import {guidanceState,guidanceStateFile,updateManagedGuidance} from '../lib/guidance-update.js';
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'cadcove-guidance-'));try{await initializeToolbox({workspace:root,cadDirectory:'design/robot',buildDirectory:'generated/cad'});await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test('upgrade changes owned instructions, preserves edits/deletions, and adopts manually accepted proposals',()=>fixture(async root=>{
 const a='.cadcove/AGENT.md',b='.cadcove/skills/frc-vision/SKILL.md',c='.cadcove/skills/frc-ctre-controls/SKILL.md';
 const before=new Map([[a,'old generated A'],[b,'old generated B'],[c,'old generated C']]);for(const [f,t] of before)await writeFile(path.join(root,f),t);
 await writeFile(path.join(root,guidanceStateFile),guidanceState(before));await writeFile(path.join(root,b),'team edited B');await rm(path.join(root,c));
 const desired=new Map([[a,'new A'],[b,'new B'],[c,'new C']]);
 const report=await updateManagedGuidance(root,desired);expect(report.ok).toBe(false);expect(report.updated).toEqual([a]);expect(report.conflicts.map(c=>c.reason)).toEqual(['locally-edited-or-legacy','locally-deleted']);expect(await readFile(path.join(root,b),'utf8')).toBe('team edited B');
 for(const conflict of report.conflicts){expect(await readFile(path.join(root,conflict.proposal),'utf8')).toBe(desired.get(conflict.file));await writeFile(path.join(root,conflict.file),desired.get(conflict.file));}
 const again=await updateManagedGuidance(root,desired);expect(again.ok).toBe(true);expect(again.updated).toEqual([]);expect(JSON.parse(await readFile(path.join(root,guidanceStateFile))).files).toEqual(JSON.parse(guidanceState(desired)).files);
}));
test('legacy baseline is never guessed and dry-run writes no proposals or state',()=>fixture(async root=>{
 await rm(path.join(root,guidanceStateFile));await writeFile(path.join(root,'.cadcove/AGENT.md'),'legacy custom instructions');
 const report=await updateToolboxGuidance({workspace:root,dryRun:true});expect(report.ok).toBe(false);expect(report.conflicts[0].file).toBe('.cadcove/AGENT.md');expect(await readdir(path.join(root,'.cadcove'))).not.toContain('guidance-updates');expect(await readdir(path.join(root,'.cadcove'))).not.toContain('guidance-state.json');
 await updateToolboxGuidance({workspace:root});expect(await readFile(path.join(root,'.cadcove/AGENT.md'),'utf8')).toBe('legacy custom instructions');
}));
test('refresh uses team CAD/build paths and preserves every project selection and instruction surface',()=>fixture(async root=>{
 const protectedFiles=['robot.sim.json','.cadcove/project.json','.cadcove/frc.json','AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'];
 await writeFile(path.join(root,'.cadcove/frc.json'),JSON.stringify({schema:1,seasonKnowledge:'private-2027',example:'my-robot'}));
 const before=await Promise.all(protectedFiles.map(f=>readFile(path.join(root,f),'utf8')));
 expect((await updateToolboxGuidance({workspace:root})).ok).toBe(true);expect(await Promise.all(protectedFiles.map(f=>readFile(path.join(root,f),'utf8')))).toEqual(before);
 const guide=await readFile(path.join(root,'.cadcove/AGENT.md'),'utf8');expect(guide).toContain('design/robot/');expect(guide).toContain('generated/cad/');
}));
test('symlink destinations, changed proposals and locks cannot overwrite team data',()=>fixture(async root=>{
 const f='.cadcove/AGENT.md',metadata=path.join(root,'.cadcove');
 const target=path.join(root,process.platform==='win32'?'external-cadcove/AGENT.md':'external.md');
 if(process.platform==='win32'){
  await rename(metadata,path.dirname(target));await writeFile(target,'external');await symlink(path.dirname(target),metadata,'junction');
 }else{await writeFile(target,'external');await rm(path.join(root,f));await symlink(target,path.join(root,f));}
 await expect(updateToolboxGuidance({workspace:root})).rejects.toThrow(process.platform==='win32'?'Unsafe initialization':'Unsafe guidance');expect(await readFile(target,'utf8')).toBe('external');
 if(process.platform==='win32'){await rm(metadata,{recursive:true});await rename(path.dirname(target),metadata);}
 else await rm(path.join(root,f));
 await writeFile(path.join(root,f),'custom');const r=await updateToolboxGuidance({workspace:root});await writeFile(path.join(root,r.conflicts[0].proposal),'custom proposal');
 await expect(updateToolboxGuidance({workspace:root})).rejects.toThrow('proposal was modified');expect(await readFile(path.join(root,f),'utf8')).toBe('custom');
 await rm(path.join(root,r.conflicts[0].proposal));await writeFile(path.join(root,'.cadcove/guidance-update.lock'),JSON.stringify({pid:process.pid}));await expect(updateToolboxGuidance({workspace:root})).rejects.toThrow('lock exists');
}));
test('invalid baseline paths cannot cause writes outside maintained guidance',()=>fixture(async root=>{
 await writeFile(path.join(root,guidanceStateFile),JSON.stringify({schema:1,files:{'../elsewhere':'a'.repeat(64)}}));await expect(updateToolboxGuidance({workspace:root})).rejects.toThrow('Invalid guidance baseline');
}));

test('older workspaces gain Claude discovery without replacing team instructions or mutating a dry run',()=>fixture(async root=>{
 await writeFile(path.join(root,'CLAUDE.md'),'Use team coding conventions.');
 const dry=await updateToolboxGuidance({workspace:root,dryRun:true});expect(dry.updated).toContain('CLAUDE.md');
 expect(await readFile(path.join(root,'CLAUDE.md'),'utf8')).toBe('Use team coding conventions.');
 await updateToolboxGuidance({workspace:root});
 const added=await readFile(path.join(root,'CLAUDE.md'),'utf8');expect(added).toStartWith('Use team coding conventions.');expect(added).toContain('.cadcove/AGENT.md');
 await updateToolboxGuidance({workspace:root});expect(await readFile(path.join(root,'CLAUDE.md'),'utf8')).toBe(added);
 await writeFile(path.join(root,'CLAUDE.md'),'<!-- cadcove:instructions:start -->');
 await expect(updateToolboxGuidance({workspace:root})).rejects.toThrow('Incomplete');
}));

test('MCP-first upgrade replaces only the original owned discovery block',()=>fixture(async root=>{
 const legacy='<!-- cadcove:instructions:start -->\nFor CAD, robot integration, simulation and practice tasks, read `.cadcove/AGENT.md` from the workspace root first.\n<!-- cadcove:instructions:end -->\n';
 await writeFile(path.join(root,'AGENTS.md'),'Team instructions\n'+legacy);
 const custom=legacy.replace('read `.cadcove/AGENT.md`','read `team.md`');await writeFile(path.join(root,'CLAUDE.md'),custom);
 await updateToolboxGuidance({workspace:root});
 const upgraded=await readFile(path.join(root,'AGENTS.md'),'utf8');expect(upgraded).toStartWith('Team instructions\n');expect(upgraded).toContain('open_robot_cad');expect(upgraded).toContain('do not read package.json');
 expect(await readFile(path.join(root,'CLAUDE.md'),'utf8')).toBe(custom);
}));
