import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NativeCadSession} from '../src/native/session.js';
import {projectLayout} from '../extensions/vscode/src/project-files.js';
const python=process.env.CADCOVE_PYTHON;
(python?test:test.skip)('CLI session supports standard CadQuery result, exact inspection, export, and rejects stale feedback',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-session-'));
 const source=n=>`import cadquery as cq\nresult = cq.Workplane('XY').box(${n},20,30)\n`;
 await fs.mkdir(path.join(root,'cad'));await fs.writeFile(path.join(root,'cad/models.py'),source(10));
 const session=new NativeCadSession({layout:await projectLayout(root,{sourceDirectory:'cad',buildDirectory:'build',entryPoint:'models.py'}),python,worker:path.resolve(import.meta.dir,'../src/native/worker.py')});
 try{
  const first=await session.build();expect(first.ok).toBe(true);expect(first.parts[0].metrics.volume).toBeCloseTo(6000);
  expect((await session.inspect('result = parts[0]["shape"].Volume()')).result).toBeCloseTo(6000);
  expect((await session.export(path.join(root,'build/model.step'))).bytes).toBeGreaterThan(1000);
  await fs.writeFile(path.join(root,'cad/models.py'),source(12));
  await expect(session.inspect('result=1')).rejects.toThrow('Source changed');
  expect((await session.build()).parts[0].metrics.volume).toBeCloseTo(7200);
  const good=await fs.readFile(path.join(root,'build/models.py/scene.bin'));
  await fs.writeFile(path.join(root,'cad/models.py'),'raise ValueError("broken edit")');
  await expect(session.build()).rejects.toThrow('broken edit');
  expect(await fs.readFile(path.join(root,'build/models.py/scene.bin'))).toEqual(good);
  await fs.writeFile(path.join(root,'cad/models.py'),source(12));
  await expect(session.inspect('result=1')).rejects.toThrow('Build successfully first');
  await fs.writeFile(path.join(root,'cad/models.py'),`import cadquery as cq\nresult = cq.Workplane('XY').pushPoints([(0,0),(30,0)]).box(10,10,10,combine=False)\n`);
  const multiple=await session.build();expect(multiple.parts[0].metrics.volume).toBeCloseTo(2000);
  expect((await session.inspect('result = len(parts[0]["shape"].Solids())')).result).toBe(2);
  await session.export(path.join(root,'build/multiple.step'));
  await fs.copyFile(path.join(root,'build/multiple.step'),path.join(root,'cad/multiple.step'));
  await fs.writeFile(path.join(root,'cad/models.py'),`def build(ctx):\n    return ctx.import_step('multiple.step')\n`);
  expect((await session.build()).parts[0].metrics.volume).toBeCloseTo(2000);
  await expect(session.inspect(`from pathlib import Path\nPath(ctx.root / 'models.py').write_text('result = None')\nresult = 1`)).rejects.toThrow('Source changed');
  await fs.writeFile(path.join(root,'cad/models.py'),`def build(ctx):\n    return ctx.import_step('../build/multiple.step')\n`);
  await expect(session.build()).rejects.toThrow('Asset leaves');
 }finally{session.dispose();await fs.rm(root,{recursive:true,force:true});}
},30000);

import {NativeCadClient,resolveNativePython} from '../src/native/client.js';
test('CLI and editor share Python precedence and project-relative paths',()=>{
 expect(resolveNativePython({explicit:'override',environment:'env',project:'project',editor:'editor'})).toBe('override');
 expect(resolveNativePython({environment:'env',project:'project',editor:'editor'})).toBe('env');
 const projectRoot=path.join(os.tmpdir(),'cad-project');
 expect(resolveNativePython({project:'.venv/bin/python',editor:'editor',root:projectRoot})).toBe(path.join(projectRoot,'.venv/bin/python'));
 expect(resolveNativePython({editor:'editor'})).toBe('editor');
 expect(resolveNativePython()).toBe('python3');
});
(python?test:test.skip)('startup errors include bounded Python stderr and executable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-startup-error-'));
 await fs.writeFile(path.join(root,'geometry.py'),'');
 const worker=path.join(root,'worker.py');
 await fs.writeFile(worker,"import sys\nsys.stderr.write('x' * 12000 + '\\nModuleNotFoundError: No module named cadquery\\n')\nsys.exit(1)\n");
 const client=new NativeCadClient({python,worker});
 try {
  let error;try{await client.request({kind:'build'});}catch(e){error=e;}
  expect(error.message).toContain('No module named cadquery');
  expect(error.message).toContain(python);
  expect(error.message.length).toBeLessThan(9000);
  // A failed process can be retried; it must not leave a resolved ready promise.
  await expect(client.request({kind:'build'})).rejects.toThrow('No module named cadquery');
 }finally{client.dispose();await fs.rm(root,{recursive:true,force:true});}
},15000);

(python?test:test.skip)('component BREP, mesh and metrics survive worker restart; changed and corrupt entries rebuild',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cad-persistent-components-')));
 const worker=path.resolve(import.meta.dir,'../src/native/worker.py');
 const layout=await projectLayout(root,{buildDirectory:'build',entryPoint:'models.py'});
 const model=`import cadquery as cq\nfrom pathlib import Path\ndef build(ctx):\n    def make(name):\n        with open(ctx.build_dir / 'calls.txt','a') as f: f.write(name+'\\n')\n        return cq.Workplane('XY').box(float(ctx.files[name+'.json']),2,3)\n    return [dict(id=n,shape=ctx.component(n,lambda n=n:make(n),dependencies=['models.py',n+'.json'])) for n in ['a','b']]\n`;
 await fs.writeFile(path.join(root,'models.py'),model);await fs.writeFile(path.join(root,'a.json'),'10');await fs.writeFile(path.join(root,'b.json'),'20');
 let session;
 const fresh=()=>{session?.dispose();session=new NativeCadSession({layout,python,worker});return session;};
 try{
  const first=await fresh().build();expect(first.timings.components).toMatchObject({hits:0,misses:2,diskHits:0});
  const calls=path.join(root,'build/models.py/calls.txt');expect((await fs.readFile(calls,'utf8')).trim().split(/\r?\n/)).toEqual(['a','b']);
  const second=await fresh().build();expect(second.timings.components).toMatchObject({hits:2,misses:0,diskHits:2});
  expect(second.parts.map(p=>p.metrics.volume)).toEqual(first.parts.map(p=>p.metrics.volume));
  expect((await session.inspect('result=[p["shape"].isValid() for p in parts]')).result).toEqual([true,true]);
  await fs.writeFile(path.join(root,'a.json'),'12');
  const changed=await fresh().build();expect(changed.timings.components).toMatchObject({hits:1,misses:1,diskHits:1});expect(changed.parts[0].metrics.volume).toBeCloseTo(72);
  const cache=path.join(root,'build/models.py/components');
  for(const file of await fs.readdir(cache))if(file.endsWith('.bin')){const raw=await fs.readFile(path.join(cache,file));raw[raw.length-1]^=1;await fs.writeFile(path.join(cache,file),raw);}
  const repaired=await fresh().build();expect(repaired.timings.components).toMatchObject({hits:0,misses:2,diskHits:0});expect(repaired.parts[0].metrics.volume).toBeCloseTo(72);
  const reused=await fresh().build();expect(reused.timings.components).toMatchObject({hits:2,misses:0,diskHits:2});
  // Valid JSON with tampered metrics must be rejected as well as corrupt BREP bytes.
  for(const file of await fs.readdir(cache))if(file.endsWith('.bin')){const raw=await fs.readFile(path.join(cache,file));const length=raw.readUInt32LE(4);const h=JSON.parse(raw.subarray(8,8+length));h.metrics.volume+=1;const header=Buffer.from(JSON.stringify(h));const prefix=Buffer.alloc(8);prefix.write('ICC1');prefix.writeUInt32LE(header.length,4);await fs.writeFile(path.join(cache,file),Buffer.concat([prefix,header,raw.subarray(8+length)]));}
  expect((await fresh().build()).timings.components.misses).toBe(2);
 }finally{session?.dispose();await fs.rm(root,{recursive:true,force:true});}
},120000);
