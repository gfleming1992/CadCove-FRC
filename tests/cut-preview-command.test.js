import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cutPreviewCommand} from '../lib/cut-preview-command.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {decodeScene} from '../vendor/cad-core/src/core/mesh.js';
import {compileCutMotion,CutSurfaces} from '../vendor/cad-core/src/core/cut-motion.js';
const request={schema:1,units:'mm-s',stock:{id:'stock',origin:[0,0,0],size:[20,12,3]},tool:{id:'tool',kind:'router',diameterMm:2,lengthMm:8},resolutionMm:.5,start:[3,3,5],moves:[{mode:'cut',to:[3,3,0],seconds:1},{mode:'cut',to:[17,3,0],seconds:3}]};
test('cut preview advertises explicit paths and no automatic CAM planning',async()=>{
 expect((await cutPreviewCommand()).toolpathPlanning).toBe(false);
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
  const p=compileCutMotion(JSON.parse(await fs.readFile(result.playbackFile,'utf8')),scene,result.sourceRevision),s=new CutSurfaces(p,scene);s.evaluate(p,4);
  expect(s.heights.some(z=>z===0)).toBe(true);expect(s.heights.some(z=>z===3)).toBe(true);
  expect(await fs.readFile(original)).toEqual(before);expect((await fs.stat(cache)).mtimeMs).toBe(stamp);
  await expect(cutPreviewCommand(options)).rejects.toThrow();
  await expect(cutPreviewCommand({...options,output:path.join(root,'outside')})).rejects.toThrow('inside');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);
