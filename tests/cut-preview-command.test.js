import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cutPreviewCommand} from '../lib/cut-preview-command.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {decodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {compileCutMotion,CutSurfaces} from '../vendor/cad-core/src/core/cut-motion.js';
const request={schema:1,units:'mm-s',stock:{id:'stock',origin:[0,0,0],size:[20,12,3]},tool:{id:'tool',kind:'bit',diameterMm:2,lengthMm:8},resolutionMm:.5,start:[3,3,5],moves:[{mode:'cut',to:[3,3,0],seconds:1},{mode:'cut',to:[17,3,0],seconds:3}]};
test('cut preview advertises explicit paths and no automatic CAM planning',async()=>{
 const caps=await cutPreviewCommand();expect(caps.toolpathPlanning).toBe(false);expect(caps.tools).toEqual(['bit','laser']);
 await expect(cutPreviewCommand({action:'plan'})).rejects.toThrow('preview');
});
test.skipIf(!process.env.CADCOVE_PYTHON)('CLI produces revision-bound native stock, preserves source, and rejects overwrite/outside output',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cad-cut-')));
 try{
  await initializeToolbox({workspace:root});
  const original=path.join(root,'cad/models.py');await fs.writeFile(original,'# Existing student CAD stays unchanged\n');const before=await fs.readFile(original);
  const input=path.join(root,'paths.json');await fs.writeFile(input,JSON.stringify(request));
  const options={action:'preview',workspace:root,input,output:path.join(root,'cad/cutting'),python:process.env.CADCOVE_PYTHON};
  const result=await cutPreviewCommand(options);expect(result.ok).toBe(true);expect(result.retainsFinishedPartAndScrap).toBe(true);
  const cache=path.join(root,'build/cadcove/cad-cache/cutting/models.py/scene.bin'),bytes=await fs.readFile(cache),stamp=(await fs.stat(cache)).mtimeMs;
  const scene=decodeScene(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  expect(scene.parts.find(p=>p.id==='tool').indices.length).toBeGreaterThan(100);
  const p=compileCutMotion(JSON.parse(await fs.readFile(result.playbackFile,'utf8')),scene,result.sourceRevision),s=new CutSurfaces(p,scene);s.evaluate(p,4);
  expect(s.heights.some(z=>z===0)).toBe(true);expect(s.heights.some(z=>z===3)).toBe(true);
  expect(await fs.readFile(original)).toEqual(before);expect((await fs.stat(cache)).mtimeMs).toBe(stamp);
  const laser=structuredClone(request);laser.tool.kind='laser';laser.tool.diameterMm=.9;laser.resolutionMm=.25;laser.start=[3,3,0];laser.moves=[{mode:'cut',to:[17,3,0],seconds:2},{mode:'rapid',to:[17,8,0],seconds:1}];
  await fs.writeFile(input,JSON.stringify(laser));
  const light=await cutPreviewCommand({...options,output:path.join(root,'cad/laser')});
  const raw=await fs.readFile(path.join(root,'build/cadcove/cad-cache/laser/models.py/scene.bin'));
  const ls=decodeScene(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
  expect(ls.parts.find(p=>p.id==='tool-nozzle').color).toBe('#707b89');expect(ls.parts.find(p=>p.id==='tool').color).toBe('#ff3b30');
  const lp=compileCutMotion(JSON.parse(await fs.readFile(light.playbackFile,'utf8')),ls,light.sourceRevision),display=new CutSurfaces(lp,ls);
  expect(display.evaluate(lp,1).opacity.tool).toBe(1);expect(display.evaluate(lp,2.5).opacity.tool).toBe(0);
  await expect(cutPreviewCommand(options)).rejects.toThrow();
  await expect(cutPreviewCommand({...options,output:path.join(root,'outside')})).rejects.toThrow('inside');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);
