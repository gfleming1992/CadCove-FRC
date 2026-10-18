import {test,expect,afterEach} from 'bun:test';
import {mkdtemp,rm,readFile,writeFile,mkdir,symlink,access,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {exportBridge} from '../lib/bridge-export.js';
const roots=[];afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function root(){const r=await mkdtemp(path.join(os.tmpdir(),'cadcove-export-'));roots.push(r);return r;}
test('export is complete, idempotent, and refuses to replace robot customizations',async()=>{
 const workspace=await root(),first=await exportBridge(workspace);expect(first.created).toBeGreaterThan(3);
 const file=path.join(first.directory,'java/org/instantcad/frc/ManagedSession.java');expect(await readFile(file,'utf8')).toContain('CADCOVE_SESSION_FILE');
 expect(await readFile(path.join(first.directory,'java/org/instantcad/frc/MotorAdapter.java'),'utf8')).toContain('interface MotorAdapter');
 expect(await readFile(path.join(first.directory,'DEVICE-ADAPTERS.md'),'utf8')).toContain('turnsPerUnit');
 expect((await exportBridge(workspace)).created).toBe(0);
 await writeFile(file,'// team customization');await expect(exportBridge(workspace)).rejects.toThrow('Refusing to overwrite');expect(await readFile(file,'utf8')).toBe('// team customization');
});
test('symlinked metadata cannot export into another workspace',async()=>{
 const workspace=await root(),outside=await root();await symlink(outside,path.join(workspace,'.cadcove'),process.platform==='win32'?'junction':'dir');await expect(exportBridge(workspace)).rejects.toThrow('symlinks');await expect(access(path.join(outside,'bridge'))).rejects.toThrow();
});
test('preflight conflict does not partially populate missing bridge files',async()=>{
 const workspace=await root(),directory=path.join(workspace,'.cadcove/bridge');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'instantcad.gradle'),'custom');await expect(exportBridge(workspace)).rejects.toThrow('Refusing to overwrite');await expect(access(path.join(directory,'java'))).rejects.toThrow();
});
test('review exports current sources separately, reports changes, and preserves custom/deleted/extra files',async()=>{
 const workspace=await root(),original=await exportBridge(workspace);
 const changed='java/org/instantcad/frc/ManagedSession.java',missing='java/org/instantcad/frc/SimVision.java';
 await writeFile(path.join(original.directory,changed),'// team customization');await rm(path.join(original.directory,missing));
 await writeFile(path.join(original.directory,'team-notes.md'),'keep me');
 const review=await exportBridge(workspace,{review:true});expect(review.review).toBe(true);
 expect(review.directory).toBe(path.join(path.dirname(original.directory),'bridge-updates',review.bundleSha256));
 expect(review.comparison.find(f=>f.file===changed)?.status).toBe('different');
 expect(review.comparison.find(f=>f.file===missing)?.status).toBe('missing');
 expect(review.comparison.find(f=>f.file==='instantcad.gradle')?.status).toBe('identical');
 expect(await readFile(path.join(review.directory,changed),'utf8')).toContain('watchLauncher');
 expect(await readFile(path.join(original.directory,changed),'utf8')).toBe('// team customization');
 await expect(access(path.join(original.directory,missing))).rejects.toThrow();
 expect(await readFile(path.join(original.directory,'team-notes.md'),'utf8')).toBe('keep me');
 expect((await exportBridge(workspace,{review:true})).created).toBe(0);
 await writeFile(path.join(original.directory,changed),await readFile(path.join(review.directory,changed)));
 expect((await exportBridge(workspace,{review:true})).comparison.find(f=>f.file===changed)?.status).toBe('identical');
});
test('review refuses edited proposals and symlinked source/destination paths before writing',async()=>{
 const workspace=await root(),original=await exportBridge(workspace),review=await exportBridge(workspace,{review:true});
 const changed='java/org/instantcad/frc/ManagedSession.java';
 await writeFile(path.join(review.directory,changed),'review notes');
 await expect(exportBridge(workspace,{review:true})).rejects.toThrow('review copy was edited');
 expect(await readFile(path.join(review.directory,changed),'utf8')).toBe('review notes');
 const outside=await root();await rm(path.join(workspace,'.cadcove/bridge-updates'),{recursive:true});
 const changedPath=path.join(original.directory,changed),parent=path.dirname(changedPath);
 if(process.platform==='win32'){
  await rename(parent,parent+'-saved');await symlink(outside,parent,'junction');
 }else{await rm(changedPath);await symlink(path.join(outside,'source.java'),changedPath);}
 await expect(exportBridge(workspace,{review:true})).rejects.toThrow('symlinks');await expect(access(path.join(workspace,'.cadcove/bridge-updates'))).rejects.toThrow();
 if(process.platform==='win32'){await rm(parent,{recursive:true});await rename(parent+'-saved',parent);}
 else await rm(changedPath);
 await symlink(outside,path.join(workspace,'.cadcove/bridge-updates'),process.platform==='win32'?'junction':'dir');
 await expect(exportBridge(workspace,{review:true})).rejects.toThrow('symlinks');await expect(access(path.join(outside,review.bundleSha256))).rejects.toThrow();
});
