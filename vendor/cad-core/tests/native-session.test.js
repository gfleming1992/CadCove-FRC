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
