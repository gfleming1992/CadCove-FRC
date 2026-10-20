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
