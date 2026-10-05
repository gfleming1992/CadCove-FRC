import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inside,readSources,artifactPath,projectLayout,cacheFile} from '../extensions/vscode/src/project-files.js';
import {compileModel} from '../extensions/vscode/src/compile-model.js';
import {readStepSource,stepEntry,isStepFile} from '../extensions/vscode/src/step-source.js';
import {snapshot} from '../src/core/revision.js';

test('editor file boundary rejects traversal and symlinks outside its project',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'instantcad-boundary-')),root=path.join(temp,'project');await mkdir(root);
 try{
  await writeFile(path.join(temp,'outside.js'),'secret');await writeFile(path.join(root,'model.js'),'export default()=>1');
  await symlink(path.join(temp,'outside.js'),path.join(root,'linked.js'));
  await expect(inside(root,'../outside.js')).rejects.toThrow();
  await expect(inside(root,'linked.js')).rejects.toThrow('leaves');
  expect(Object.keys(await readSources(root))).toEqual(['model.js']);
  await symlink(temp,path.join(root,'.instantcad'));
  await expect(inside(root,'.instantcad/scene.bin',{create:true})).rejects.toThrow('leaves');
  expect(artifactPath('robot/model.js','scene.bin')).toBe('robot/.instantcad/scene.bin');
  expect(artifactPath('robot/assembly.js','scene.bin')).toBe('robot/.instantcad/entries/assembly.js/scene.bin');
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('direct STEP preview hashes only the selected asset and leaves source untouched',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'instantcad-step-preview-'));
 try{
  await mkdir(path.join(root,'parts'));await writeFile(path.join(root,'parts/BOX.STP'),'first');
  await writeFile(path.join(root,'oversized.js'),'x'.repeat(2*1024*1024));
  const entry=stepEntry('parts/BOX.STP'),first=await readStepSource(root,'parts/BOX.STP');
  expect(isStepFile('part.StEp')).toBe(true);expect(isStepFile('part.step.js')).toBe(false);
  expect(Object.keys(first)).toEqual([entry]);
  await compileModel(first,entry);
  const a=await snapshot(first,entry);await writeFile(path.join(root,'parts/BOX.STP'),'second');
  const b=await snapshot(await readStepSource(root,'parts/BOX.STP'),entry);expect(a.revision).not.toBe(b.revision);
  expect(await Bun.file(path.join(root,entry)).exists()).toBe(false);
  await expect(readStepSource(root,'../escape.step')).rejects.toThrow();
  await symlink(path.join(root,'../'+path.basename(root)+'.step'),path.join(root,'parts/link.step'));
  await writeFile(root+'.step','outside');
  await expect(readStepSource(root,'parts/link.step')).rejects.toThrow('leaves');
 }finally{await rm(root+'.step',{force:true});await rm(root,{recursive:true,force:true});}
});

test('STEP preview executes in the CAD kernel with assembly placement, colors and validation',async()=>{
 const {OcctKernel}=await import('occt-wasm'),brepjs=await import('brepjs');
 const {collect}=await import('../src/core/geometry.js');
 const occt=await OcctKernel.init({wasm:await Bun.file('node_modules/occt-wasm/dist/occt-wasm.wasm').arrayBuffer()});
 const adapter=brepjs.OcctWasmAdapter.fromKernel(occt);brepjs.registerKernel('occt-wasm',adapter);
 const root=await mkdtemp(path.join(tmpdir(),'instantcad-step-kernel-'));
 try{
  const doc=occt.createXCAFDocument(),box=occt.makeBox(10,20,30);
  const assembly=doc.addShape(occt.makeCompound([box,occt.translate(box,100,0,0)]),{assembly:true,name:'two boxes'});
  const children=doc.getChildren(assembly);doc.setColor(children[0],[1,0,0]);doc.setColor(children[1],[0,0,1]);
  await writeFile(path.join(root,'assembly.step'),doc.exportSTEP());
  // Verify generic XCAF occurrence colors before STEP exchange (the OCCT
  // wrapper does not expose every surface-style encoding after STEP import).
  const {buildStepScene}=await import('../src/core/step-model.js');
  const importOriginal=occt.importXCAFFromSTEP;occt.importXCAFFromSTEP=()=>doc;
  try{expect(buildStepScene({occt,adapter,brepjs},new Uint8Array(),'fixture').map(p=>p.color)).toEqual(['#ff0000','#0000ff']);}
  finally{occt.importXCAFFromSTEP=importOriginal;}
  const entry=stepEntry('assembly.step'),files=await readStepSource(root,'assembly.step');
  const module={exports:{}};new Function('require','module','exports',await compileModel(files,entry))(()=>brepjs,module,module.exports);
  const parts=await module.exports.default({occt,adapter,brepjs,readAsset:async file=>new Uint8Array(await Bun.file(path.join(root,file)).arrayBuffer())});
  const scene=collect(parts,adapter);expect(scene).toHaveLength(2);
  expect(scene.every(p=>p.metrics.valid&&Math.abs(p.metrics.volume-6000)<.01)).toBe(true);
  expect(Math.max(...scene.map(p=>p.metrics.bounds.max[0]))).toBeCloseTo(110,3);
  expect(parts.every(p=>/^#[0-9a-f]{6}$/.test(p.color))).toBe(true);
 }finally{occt[Symbol.dispose]();await rm(root,{recursive:true,force:true});}
},30000);
test('editor compiler handles shared modules and cycles but never evaluates the model in the host',async()=>{
 const files={
  'model.js':"import {value} from './a.js'; import * as cad from 'brepjs'; export default ()=>({value,answer:cad.answer});",
  'a.js':"import {suffix} from './b.js'; export const value='hello'+suffix; export function other(){return 1;}",
  'b.js':"import {other} from './a.js'; export const suffix='world'; export const fn=()=>other();",
 };
 const bundle=await compileModel(files,'model.js'),module={exports:{}};
 new Function('require','module','exports',bundle)(()=>({answer:42}),module,module.exports);
 expect(module.exports.default()).toEqual({value:'helloworld',answer:42});
 await expect(compileModel({'model.js':"import fs from 'node:fs'; export default()=>fs"},'model.js')).rejects.toThrow('Unsupported');
 await expect(compileModel({'model.js':"import x from '../outside.js'; export default()=>x"},'model.js')).rejects.toThrow('Missing');
 const unevaluated=await compileModel({'model.js':"throw Error('must not run'); export default()=>1"},'model.js');
 expect(unevaluated).toContain('must not run');
});
test('configured source and build folders isolate CAD inputs and per-entry outputs',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'instantcad-layout-'));
 try{
  await mkdir(path.join(root,'cad/generated'),{recursive:true});
  await writeFile(path.join(root,'cad/model.js'),'export default()=>1');
  await writeFile(path.join(root,'cad/generated/output.js'),'not source');
  const layout=await projectLayout(root,{sourceDirectory:'cad',buildDirectory:'build/cad',entryPoint:'assemblies/drive.js'});
  expect(layout.sourceRoot).toBe(path.join(root,'cad'));
  expect(await cacheFile(layout,layout.entryPoint,'scene.bin',{create:true})).toBe(path.join(root,'build/cad/assemblies/drive/scene.bin'));
  const nested=await projectLayout(root,{sourceDirectory:'cad',buildDirectory:'cad/generated'});
  expect(Object.keys(await readSources(nested.sourceRoot,nested.buildRoot))).toEqual(['model.js']);
  await expect(projectLayout(root,{sourceDirectory:'cad',buildDirectory:'cad'})).rejects.toThrow('cannot contain');
  await expect(projectLayout(root,{sourceDirectory:'cad/generated',buildDirectory:'cad'})).rejects.toThrow('cannot contain');
  await expect(projectLayout(root,{sourceDirectory:'../outside'})).rejects.toThrow();
  await expect(projectLayout(root,{sourceDirectory:'cad',buildDirectory:'../outside'})).rejects.toThrow();
  await expect(cacheFile(layout,'../escape.js','scene.bin',{create:true})).rejects.toThrow();
  const defaults=await projectLayout(root,{sourceDirectory:'cad'});
  expect(await cacheFile(defaults,'model.js','scene.bin',{create:true})).toBe(path.join(root,'cad/.instantcad/scene.bin'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('browser and editor accept large assemblies and enforce the same bounded source budget',async()=>{
 const {readFolder}=await import('../src/mirror.js');
 const {SOURCE_LIMITS,checkSourceBudget}=await import('../src/core/source-limits.js');
 const root=await mkdtemp(path.join(tmpdir(),'instantcad-large-source-'));
 const text='//'+ 'x'.repeat(900000), entries=Array.from({length:6},(_,i)=>['part'+i+'.js',{kind:'file',getFile:async()=>new File([text],'part.js')}]);
 const folder={async *entries(){yield* entries;}};
 try{
  for(const [name]of entries)await writeFile(path.join(root,name),text);
  expect(Object.keys(await readSources(root))).toHaveLength(6);
  expect(Object.keys(await readFolder(folder))).toHaveLength(6);
  expect(()=>checkSourceBudget(1024,16*1024*1024)).not.toThrow();
  expect(()=>checkSourceBudget(1025,1)).toThrow('source limits');
  expect(()=>checkSourceBudget(1,16*1024*1024+1)).toThrow('source limits');
  const oversized={async *entries(){for(let i=0;i<19;i++)yield['p'+i+'.js',entries[0][1]];}};
  await expect(readFolder(oversized)).rejects.toThrow('source limits');
  for(let i=6;i<19;i++)await writeFile(path.join(root,'part'+i+'.js'),text);
  await expect(readSources(root)).rejects.toThrow('source limits');
  await writeFile(path.join(root,'a-big.js'),'x'.repeat(SOURCE_LIMITS.fileBytes+1));
  await expect(readSources(root)).rejects.toThrow('exceeds 1 MB');
 }finally{await rm(root,{recursive:true,force:true});}
});
