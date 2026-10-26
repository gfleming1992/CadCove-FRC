import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {subsystemCommand} from '../lib/subsystem-command.js';
import {readSources} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {snapshot} from '../vendor/cad-core/src/core/revision.js';
async function fixture(run){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-subsystem-test-'));
 const put=async(file,value)=>{await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));};
 try{
  await put('.cadcove/project.json',{schema:1,sourceDirectory:'cad',buildDirectory:'build/cad',entryPoint:'model.py'});
  await put('cad/model.py','# Synthetic test fixture; does not run Python\nresult = None\n');
  await put('cad/mechanism.json',{bodies:[{id:'part-body',fixed:true,parts:['part'],physics:{massKg:1,centerOfMassMm:[0,0,0],principalInertiaKgMm2:[1,1,1],friction:.5,colliders:[{kind:'box',centerMm:[0,0,0],halfMm:[1,1,1]}],provenance:'Synthetic test only'}}],joints:[],motors:[],relations:[]});
  const tree={id:'assembly',children:[{id:'part'}]};await put('config/tree.json',tree);
  const manifest={schema:1,trees:[{id:'tree',kind:'cadquery',file:'config/tree.json'}],subsystems:[{id:'part',roots:{assemblies:['assembly']},mechanical:{bodies:['part-body']},requirements:{contactBodies:['part-body'],materials:['fuel']},provenance:{status:'estimated',evidence:'Synthetic test only'}}]};
  await put('config/game-piece-materials.json',{schema:1,gamePieces:{fuel:{massKg:.2}}});
  const runtime='synthetic-subsystem-loader-test',source=await snapshot(await readSources(path.join(root,'cad'),path.join(root,'build/cad/cad-cache'),{native:true}),'model.py',runtime);
  // A unit-test feedback fixture only; never written into a user workspace.
  await put('build/cad/cad-cache/model.py/status.json',{ok:true,revision:source.revision,runtime,parts:[{id:'part',name:'Part'}]});
  manifest.sourceRevision=source.revision;manifest.treeRevisions={tree:createHash('sha256').update(JSON.stringify(tree)).digest('hex')};
  await put('config/subsystems.json',manifest);
  await run({root,put,manifest,tree,revision:source.revision});
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('loader resolves actual CAD sourceRevision and hashes tree input for pins',async()=>fixture(async({root,revision})=>{const r=await subsystemCommand({workspace:root,action:'inspect',id:'part'});expect(r.sourceRevision).toBe(revision);expect(r.occurrenceIds).toEqual(['part']);expect(r.physics.complete).toBe(true);expect((await subsystemCommand({workspace:root,action:'validate',id:'part'})).ok).toBe(true);}));
test('same-ID tree edit invalidates pinned byte revision',async()=>fixture(async({root,put,tree})=>{tree.children[0].name='changed';await put('config/tree.json',tree);await expect(subsystemCommand({workspace:root,action:'inspect',id:'part'})).rejects.toThrow('Stale subsystem tree revision');}));
test('authored tree revision cannot spoof changed input hash',async()=>fixture(async({root,put,manifest})=>{manifest.trees[0].revision='invented';await put('config/subsystems.json',manifest);await expect(subsystemCommand({workspace:root,action:'inspect',id:'part'})).rejects.toThrow('Stale subsystem tree descriptor');}));
test('changed CAD source cannot use saved feedback',async()=>fixture(async({root,put})=>{await put('cad/model.py','result = 1\n');await expect(subsystemCommand({workspace:root,action:'inspect',id:'part'})).rejects.toThrow('Build current CAD');}));
test('list rejects unsupported manifest and cyclic dependencies without needing CAD',async()=>fixture(async({root,put,manifest})=>{manifest.schema=99;await put('config/subsystems.json',manifest);await expect(subsystemCommand({workspace:root,action:'list'})).rejects.toThrow('Unsupported');manifest.schema=1;manifest.subsystems[0].dependencies=['part'];await put('config/subsystems.json',manifest);await expect(subsystemCommand({workspace:root,action:'list'})).rejects.toThrow('cycle');}));
test('realpath containment rejects symlinked external manifest',async()=>fixture(async({root})=>{const outside=await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-subsystem-outside-'));try{await fs.writeFile(path.join(outside,'manifest.json'),JSON.stringify({schema:1,subsystems:[]}));await fs.symlink(path.join(outside,'manifest.json'),path.join(root,'escape.json'));await expect(subsystemCommand({workspace:root,action:'list',manifest:'escape.json'})).rejects.toThrow('inside workspace');}finally{await fs.rm(outside,{recursive:true,force:true});}}));
test('inspect reports missing material but validate returns incomplete',async()=>fixture(async({root})=>{await fs.unlink(path.join(root,'config/game-piece-materials.json'));const r=await subsystemCommand({workspace:root,action:'validate',id:'part'});expect(r.ok).toBe(false);expect(r.physics.issues).toContainEqual({code:'missing-material',material:'fuel'});}));
