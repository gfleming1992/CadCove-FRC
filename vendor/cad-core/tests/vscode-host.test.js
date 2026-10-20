import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inside,readSources,artifactPath,projectLayout,cacheFile} from '../extensions/vscode/src/project-files.js';
import {readStepSource,stepEntry,isStepFile} from '../extensions/vscode/src/step-source.js';
import {snapshot} from '../src/core/revision.js';

test('editor file boundary rejects traversal and symlinks outside its project',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'instantcad-boundary-')),root=path.join(temp,'project');await mkdir(root);
 try{
  await writeFile(path.join(temp,'outside.py'),'secret');await writeFile(path.join(root,'models.py'),'export default()=>1');
  // Junctions exercise the same escaped-file boundary without administrator
  // privileges on Windows. POSIX keeps coverage of direct file symlinks.
  const linked=process.platform==='win32'?'linked/outside.py':'linked.py';
  if(process.platform==='win32')await symlink(temp,path.join(root,'linked'),'junction');
  else await symlink(path.join(temp,'outside.py'),path.join(root,'linked.py'));
  await expect(inside(root,'../outside.py')).rejects.toThrow();
  await expect(inside(root,linked)).rejects.toThrow('leaves');
  expect(Object.keys(await readSources(root))).toEqual(['models.py']);
  await symlink(temp,path.join(root,'.instantcad'),process.platform==='win32'?'junction':'dir');
  await expect(inside(root,'.instantcad/scene.bin',{create:true})).rejects.toThrow('leaves');
  expect(artifactPath('robot/models.py','scene.bin')).toBe('robot/.instantcad/entries/models.py/scene.bin');
  expect(artifactPath('robot/assembly.py','scene.bin')).toBe('robot/.instantcad/entries/assembly.py/scene.bin');
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('direct STEP preview hashes only the selected asset and leaves source untouched',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'instantcad-step-preview-'));
 try{
  await mkdir(path.join(root,'parts'));await writeFile(path.join(root,'parts/BOX.STP'),'first');
  await writeFile(path.join(root,'oversized.py'),'x'.repeat(2*1024*1024));
  const entry=stepEntry('parts/BOX.STP'),first=await readStepSource(root,'parts/BOX.STP');
  expect(isStepFile('part.StEp')).toBe(true);expect(isStepFile('part.step.js')).toBe(false);
  expect(Object.keys(first)).toEqual([entry,'parts/BOX.STP']);
  const a=await snapshot(first,entry);await writeFile(path.join(root,'parts/BOX.STP'),'second');
  const b=await snapshot(await readStepSource(root,'parts/BOX.STP'),entry);expect(a.revision).not.toBe(b.revision);
  expect(await Bun.file(path.join(root,entry)).exists()).toBe(false);
  await expect(readStepSource(root,'../escape.step')).rejects.toThrow();
  const linked=process.platform==='win32'?'parts/external/'+path.basename(root)+'.step':'parts/link.step';
  if(process.platform==='win32')await symlink(path.dirname(root),path.join(root,'parts/external'),'junction');
  else await symlink(root+'.step',path.join(root,'parts/link.step'));
  await writeFile(root+'.step','outside');
  await expect(readStepSource(root,linked)).rejects.toThrow('leaves');
 }finally{await rm(root+'.step',{force:true});await rm(root,{recursive:true,force:true});}
});

test('configured source and build folders isolate CAD inputs and per-entry outputs',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'instantcad-layout-'));
 try{
  await mkdir(path.join(root,'cad/generated'),{recursive:true});
  await writeFile(path.join(root,'cad/models.py'),'export default()=>1');
  await writeFile(path.join(root,'cad/generated/output.py'),'not source');
  const layout=await projectLayout(root,{sourceDirectory:'cad',buildDirectory:'build/cad',entryPoint:'assemblies/drive.py'});
  expect(layout.sourceRoot).toBe(path.join(root,'cad'));
  expect(await cacheFile(layout,layout.entryPoint,'scene.bin',{create:true})).toBe(path.join(root,'build/cad/assemblies/drive.py/scene.bin'));
  const nested=await projectLayout(root,{sourceDirectory:'cad',buildDirectory:'cad/generated'});
  expect(Object.keys(await readSources(nested.sourceRoot,nested.buildRoot))).toEqual(['models.py']);
  await expect(projectLayout(root,{sourceDirectory:'cad',buildDirectory:'cad'})).rejects.toThrow('cannot contain');
  await expect(projectLayout(root,{sourceDirectory:'cad/generated',buildDirectory:'cad'})).rejects.toThrow('cannot contain');
  await expect(projectLayout(root,{sourceDirectory:'../outside'})).rejects.toThrow();
  await expect(projectLayout(root,{sourceDirectory:'cad',buildDirectory:'../outside'})).rejects.toThrow();
  await expect(cacheFile(layout,'../escape.py','scene.bin',{create:true})).rejects.toThrow();
  await expect(projectLayout(root,{entryPoint:'legacy.js'})).rejects.toThrow('Convert legacy');
  const defaults=await projectLayout(root,{sourceDirectory:'cad'});
  expect(await cacheFile(defaults,'models.py','scene.bin',{create:true})).toBe(path.join(root,'cad/.instantcad/entries/models.py/scene.bin'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('native editor accepts large assemblies and enforce the same bounded source budget',async()=>{
 const {SOURCE_LIMITS,checkSourceBudget}=await import('../src/core/source-limits.js');
 const root=await mkdtemp(path.join(tmpdir(),'instantcad-large-source-'));
 const text='//'+ 'x'.repeat(900000), entries=Array.from({length:6},(_,i)=>['part'+i+'.py',{kind:'file',getFile:async()=>new File([text],'part.py')}]);
 const folder={async *entries(){yield* entries;}};
 try{
  for(const [name]of entries)await writeFile(path.join(root,name),text);
  expect(Object.keys(await readSources(root))).toHaveLength(6);
  expect(()=>checkSourceBudget(1024,16*1024*1024)).not.toThrow();
  expect(()=>checkSourceBudget(1025,1)).toThrow('source limits');
  expect(()=>checkSourceBudget(1,16*1024*1024+1)).toThrow('source limits');
  const oversized={async *entries(){for(let i=0;i<19;i++)yield['p'+i+'.py',entries[0][1]];}};
  for(let i=6;i<19;i++)await writeFile(path.join(root,'part'+i+'.py'),text);
  await expect(readSources(root)).rejects.toThrow('source limits');
  await writeFile(path.join(root,'a-big.py'),'x'.repeat(SOURCE_LIMITS.fileBytes+1));
  await expect(readSources(root)).rejects.toThrow('exceeds 1 MB');
 }finally{await rm(root,{recursive:true,force:true});}
});

import {currentCachedScene} from '../src/core/scene-cache.js';
import {encodeScene} from '../src/core/mesh.js';
import {hash} from '../src/core/revision.js';
test('external scene adoption rejects stale, corrupt, and wrong-runtime builds',async()=>{
 const bytes=encodeScene({parts:[{id:'triangle',name:'Triangle',color:'#112233',positions:new Float32Array([0,0,0,1,0,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2])}]});
 const cached={revision:'current',runtime:'native',meshHash:await hash(bytes),bytes};
 expect((await currentCachedScene(cached,'current','native')).parts).toHaveLength(1);
 expect(await currentCachedScene(cached,'newer','native')).toBeNull();
 expect(await currentCachedScene(cached,'current','other-runtime')).toBeNull();
 expect(await currentCachedScene({...cached,meshHash:'invalid'},'current','native')).toBeNull();
 const corrupt=new Uint8Array([1,2,3]).buffer;
 expect(await currentCachedScene({...cached,bytes:corrupt,meshHash:await hash(corrupt)},'current','native')).toBeNull();
});
