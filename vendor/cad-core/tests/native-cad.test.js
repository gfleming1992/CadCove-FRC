import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeCadClient,nativeRuntimeIdentity} from '../src/native/client.js';
import {decodeScene} from '../src/core/mesh.js';
import {readSources,projectLayout} from '../extensions/vscode/src/project-files.js';
import {snapshot} from '../src/core/revision.js';

const python=process.env.CADCOVE_PYTHON;
(python?test:test.skip)('native operation timeout reports the deadline and permits a fresh worker',async()=>{
 const client=new NativeCadClient({python,worker:fileURLToPath(new URL('../src/native/worker.py',import.meta.url)),timeout:100});
 try{
  await expect(client.request({kind:'inspect',code:'import time\ntime.sleep(5)\nresult=1'})).rejects.toThrow('Native CAD build timed out');
  client.timeout=5000;
  expect(await client.request({kind:'inspect',code:'result=2'})).toBe(2);
 }finally{client.dispose();}
},90000);
(python?test:test.skip)('native process builds, invalidates changed Python, preserves accepted output on errors, and restarts after cancel',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cadcove-native-'));
 const client=new NativeCadClient({python,worker:fileURLToPath(new URL('../src/native/worker.py',import.meta.url))});
 const model=`import cadquery as cq\nfrom dimensions import width\ndef build(ctx):\n    print('Model stdout stays out of the protocol')\n    shape=ctx.component('box',lambda:cq.Workplane('XY').box(width,4,5))\n    return [{'id':'box','color':'#ff0000','shape':shape}]\n`;
 const build=async()=>{
  const files=await readSources(root,undefined,{native:true});
  const source=await snapshot(files,'model.py',nativeRuntimeIdentity);
  const result=await client.request({kind:'build',root,entry:'model.py',files,revision:source.revision,output:path.join(root,'scene.bin')});
  return {...result,scene:decodeScene(await Bun.file(path.join(root,'scene.bin')).arrayBuffer())};
 };
 try{
  await writeFile(path.join(root,'model.py'),model);await writeFile(path.join(root,'dimensions.py'),'width=3\n');
  expect((await projectLayout(root,{entryPoint:'model.py'})).entryPoint).toBe('model.py');
  const first=await build();expect(first.scene.parts[0].metrics.volume).toBeCloseTo(60);expect(first.scene.parts[0].color).toBe('#ff0000');
  const warm=await build();expect(warm.timings.components.hits).toBe(1);
  await writeFile(path.join(root,'dimensions.py'),'width=6\n');
  const edited=await build();expect(edited.scene.parts[0].metrics.volume).toBeCloseTo(120);expect(edited.revision).not.toBe(first.revision);expect(edited.timings.components.misses).toBe(1);
  const translated=model.replace("return [{'id'", "shape.move(cq.Location(cq.Vector(10,0,0)))\n    return [{'id'");
  await writeFile(path.join(root,'model.py'),translated);
  const moved=await build();expect(moved.scene.parts[0].metrics.bounds.min[0]).toBeCloseTo(7);
  const movedAgain=await build();expect(movedAgain.scene.parts[0].metrics.bounds.min[0]).toBeCloseTo(7);
  const accepted=await readFile(path.join(root,'scene.bin'));
  await writeFile(path.join(root,'model.py'),'raise ValueError("intentional failure")');
  await expect(build()).rejects.toThrow('intentional failure');expect(await readFile(path.join(root,'scene.bin'))).toEqual(accepted);
  await writeFile(path.join(root,'model.py'),model);client.dispose();
  expect((await build()).scene.parts[0].metrics.volume).toBeCloseTo(120);
  expect(await client.request({kind:'inspect',code:'result = parts[0]["shape"].Volume()'})).toBeCloseTo(120);
 }finally{client.dispose();await rm(root,{recursive:true,force:true});}
},90000);

(python?test:test.skip)('native assembly reuses prototype meshes with rigid placements and exact inspection',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'cadcove-native-instances-'));
 const client=new NativeCadClient({python,worker:fileURLToPath(new URL('../src/native/worker.py',import.meta.url))});
 const model=`import cadquery as cq\ndef build(ctx):\n    s=ctx.component('stock',lambda:cq.Workplane('XY').box(2,4,6))\n    return [{'id':'a','shape':s},{'id':'b','shape':s,'transform':[0,-1,0,10,1,0,0,20,0,0,1,30]}]\n`;
 const build=async()=>{const files=await readSources(root,undefined,{native:true});return client.request({kind:'build',root,entry:'models.py',files,revision:'test',output:path.join(root,'scene.bin')});};
 try{
  await writeFile(path.join(root,'models.py'),model);
  expect((await build()).timings.uniquePrototypes).toBe(1);
  const scene=decodeScene(await Bun.file(path.join(root,'scene.bin')).arrayBuffer());
  expect(scene.parts[1].metrics.bounds.min).toEqual([8,19,27]);
  expect(scene.parts[1].metrics.bounds.max).toEqual([12,21,33]);
  expect(scene.parts[1].metrics.volume).toBeCloseTo(48);
  expect(await client.request({kind:'inspect',code:'result = list(parts[1]["shape"].Center().toTuple())'})).toEqual([10,20,30]);
  expect((await build()).timings.components.hits).toBe(1);
  await writeFile(path.join(root,'models.py'),model.replace('0,-1,0,10','0,-2,0,10'));
  await expect(build()).rejects.toThrow('proper rigid placement');
 }finally{client.dispose();await rm(root,{recursive:true,force:true});}
},90000);

(python?test:test.skip)('native direct STEP preview preserves assembly placements and colors',async()=>{
 const {readStepSource,stepEntry}=await import('../extensions/vscode/src/step-source.js');
 const root=await mkdtemp(path.join(tmpdir(),'cadcove-step-colors-'));
 const client=new NativeCadClient({python,worker:fileURLToPath(new URL('../src/native/worker.py',import.meta.url))});
 try{
  const script=`import cadquery as cq\na=cq.Assembly(name='fixture')\na.add(cq.Workplane('XY').box(2,4,6),name='red',color=cq.Color(1,0,0))\na.add(cq.Workplane('XY').box(2,4,6),name='blue',color=cq.Color(0,0,1),loc=cq.Location(cq.Vector(10,20,30)))\na.save('fixture.step')\n`;
  const child=Bun.spawn([python,'-B','-c',script],{cwd:root,stdout:'pipe',stderr:'pipe'});await new Response(child.stdout).text();const stderr=await new Response(child.stderr).text();expect(await child.exited,stderr).toBe(0);
  const files=await readStepSource(root,'fixture.step');
  await client.request({kind:'build',root,entry:stepEntry('fixture.step'),stepAsset:'fixture.step',files,revision:'step-fixture',output:path.join(root,'scene.bin')});
  const scene=decodeScene(await Bun.file(path.join(root,'scene.bin')).arrayBuffer());
  expect(scene.parts).toHaveLength(2);expect(scene.parts.map(p=>p.color).sort()).toEqual(['#0000ff','#ff0000']);
  const blue=scene.parts.find(p=>p.color==='#0000ff');expect(blue.metrics.bounds.min).toEqual([9,18,27]);expect(blue.metrics.bounds.max).toEqual([11,22,33]);
 }finally{client.dispose();await rm(root,{recursive:true,force:true});}
},90000);
