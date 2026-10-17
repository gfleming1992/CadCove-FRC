import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {cadFeedback} from '../lib/cad-feedback.js';
import {snapshot} from '../vendor/cad-core/src/core/revision.js';

test('agent feedback distinguishes unbuilt, fresh, stale and failed source revisions',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cadcove-feedback-'));
 try{
  await initializeToolbox({workspace:root});
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({schema:1,sourceDirectory:'cad',buildDirectory:'build/cadcove',entryPoint:'models.py'}));
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({schema:1,sourceDirectory:'cad',buildDirectory:'build/cadcove',entryPoint:'models.py'}));
 const code='def build(ctx): return []\n';await writeFile(path.join(root,'cad/models.py'),code);
  expect((await cadFeedback(root)).state).toBe('missing-feedback');
  const cache=path.join(root,'build/cadcove/cad-cache/models.py');await mkdir(cache,{recursive:true});
  const {revision}=await snapshot({'models.py':code});
  await writeFile(path.join(cache,'status.json'),JSON.stringify({ok:true,revision,parts:[],timings:{buildMs:1}}));
  expect((await cadFeedback(root)).state).toBe('ready');
  expect((await cadFeedback(root,{preview:true})).state).toBe('missing-preview');
  await writeFile(path.join(cache,'preview.png'),Buffer.from('fixture image'));
  await writeFile(path.join(cache,'status.json'),JSON.stringify({ok:true,revision,parts:[],preview:{revision,sha256:createHash('sha256').update('fixture image').digest('hex')}}));
  expect((await cadFeedback(root,{preview:true})).image).toBe(path.join(cache,'preview.png'));
  await writeFile(path.join(cache,'preview.png'),'different build image');
  expect((await cadFeedback(root,{preview:true})).state).toBe('stale-preview');
  await writeFile(path.join(root,'cad/models.py'),code+'# source changed\n');
  expect((await cadFeedback(root)).state).toBe('stale-feedback');
  expect((await cadFeedback(root,{preview:true})).ok).toBe(false);
  await writeFile(path.join(cache,'status.json'),JSON.stringify({ok:false,revision,error:'test geometry failure'}));
  expect((await cadFeedback(root)).error).toBe('test geometry failure');
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({schema:1,sourceDirectory:'cad',buildDirectory:'../outside',entryPoint:'models.py'}));
  await expect(cadFeedback(root)).rejects.toThrow('relative path');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI validates source against the editor kernel identity and still rejects stale source',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cadcove-feedback-kernel-'));
 try{
  await initializeToolbox({workspace:root});
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({schema:1,sourceDirectory:'cad',buildDirectory:'build/cadcove',entryPoint:'models.py'}));
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({schema:1,sourceDirectory:'cad',buildDirectory:'build/cadcove',entryPoint:'models.py'}));
 const code='def build(ctx): return []',runtime='kernel:locally-rebuilt';
  await writeFile(path.join(root,'cad/models.py'),code);
  const cache=path.join(root,'build/cadcove/cad-cache/models.py');await mkdir(cache,{recursive:true});
  const {revision}=await snapshot({'models.py':code},'models.py',runtime);
  await writeFile(path.join(cache,'status.json'),JSON.stringify({ok:true,revision,runtime,parts:[]}));
  const result=await cadFeedback(root);expect(result.ok).toBe(true);expect(result.runtime).toBe(runtime);expect(result.sourceRevision).toBe(revision);
  await writeFile(path.join(root,'cad/models.py'),code+'# edit');
  expect((await cadFeedback(root)).state).toBe('stale-feedback');
  await writeFile(path.join(cache,'status.json'),JSON.stringify({ok:true,revision,runtime:42}));
  await expect(cadFeedback(root)).rejects.toThrow('runtime identity');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Python CAD feedback uses native runtime identity and tracks imported asset revisions',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cadcove-native-feedback-'));
 try{
  await initializeToolbox({workspace:root});
  await writeFile(path.join(root,'.cadcove/project.json'),JSON.stringify({schema:1,sourceDirectory:'cad',buildDirectory:'build/cadcove',entryPoint:'model.py'}));
  const code='def build(ctx): return []\n',runtime='cadquery@2.6.1/ocp@7.8.1.1/native-mesh-v1/worker:test';
  await writeFile(path.join(root,'cad/model.py'),code);await writeFile(path.join(root,'cad/part.step'),'fixture');
  const {readSources}=await import('../vendor/cad-core/extensions/vscode/src/project-files.js');
  const files=await readSources(path.join(root,'cad'),undefined,{native:true});
  expect(files['models.py']).toBeUndefined();
  const {revision}=await snapshot(files,'model.py',runtime);
  const cache=path.join(root,'build/cadcove/cad-cache/model.py');await mkdir(cache,{recursive:true});
  await writeFile(path.join(cache,'status.json'),JSON.stringify({ok:true,revision,runtime,parts:[]}));
  expect((await cadFeedback(root)).state).toBe('ready');
  await writeFile(path.join(root,'cad/part.step'),'changed fixture');
  expect((await cadFeedback(root)).state).toBe('stale-feedback');
 }finally{await rm(root,{recursive:true,force:true});}
});
