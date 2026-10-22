import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sheetmetalCommand} from '../lib/sheetmetal-command.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {createHash} from 'node:crypto';

test('sheet metal contract requires external headless backend and explicit unfold inputs',async()=>{
 const cap=await sheetmetalCommand();expect(cap.requiresGUI).toBe(false);expect(cap.requiresEditor).toBe(false);
 expect(cap.commands).toEqual(['unfold']);
 await expect(sheetmetalCommand({action:'bend'})).rejects.toThrow('unfold');
 await expect(sheetmetalCommand({action:'unfold',input:'request.json',output:'out',freecad:'relative',sheetmetal:'/missing'})).rejects.toThrow('absolute');
});

test.skipIf(!process.env.CADCOVE_PYTHON)('native sheet metal validation and optional real FreeCAD unfolding',async()=>{
 const p=Bun.spawn([process.env.CADCOVE_PYTHON,path.resolve('vendor/cad-core/tests/sheetmetal-native.py')],{stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(code,out+'\n'+err).toBe(0);
},60000);

test.skipIf(!process.env.CADCOVE_PYTHON||!process.env.CADCOVE_FREECAD||!process.env.CADCOVE_SHEETMETAL)('CLI unfolds current CAD, preserves sources/cache and returns actual DXF/SVG without an editor',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-sheetmetal-')));
 try{
  await initializeToolbox({workspace:root});
  const model=path.join(root,'cad/models.py');
  const source=`import cadquery as cq
from math import sqrt
def build(ctx):
 def make():
  p=cq.Workplane('XZ').moveTo(-40,0).lineTo(0,0).threePointArc((5/sqrt(2),5-5/sqrt(2)),(5,5)).lineTo(5,35).lineTo(3,35).lineTo(3,5).threePointArc((3/sqrt(2),5-3/sqrt(2)),(0,2)).lineTo(-40,2).close().extrude(20).val()
  return p.cut(cq.Solid.makeCylinder(2,4,cq.Vector(-20,-10,-1)))
 return [dict(id='bracket',shape=ctx.component('bracket',make,dependencies=['models.py']))]
`;
  await fs.writeFile(model,source);
  const input=path.join(root,'sheet.json');
  await fs.writeFile(input,JSON.stringify({schema:1,part:'bracket',thicknessMm:2,rootFace:{id:'base',part:'bracket',kind:'plane',point:[-20,-10,0],axis:[0,0,-1]},kFactor:{value:.4,standard:'ansi',source:'Synthetic test assumption'}}));
  const cli=path.resolve('bin/cadcove.js');
  async function run(output){
   const p=Bun.spawn([process.execPath,cli,'cad-sheetmetal','--action','unfold','--workspace',root,'--input',input,'--output',output,'--show','--explain'],{stdout:'pipe',stderr:'pipe'});
   const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(code,err+'\n'+out).toBe(0);return JSON.parse(out);
  }
  const first=await run(path.join(root,'first'));
  expect(first.ok).toBe(true);expect(first.backend.guiUp).toBe(0);expect(first.backend.bendCount).toBe(1);
  expect(first.display.ok).toBe(false);expect(first.flat.holeCount).toBe(1);expect(first.sourceRevision).toBeTruthy();
  expect(await fs.readFile(first.svg,'utf8')).toContain('<svg');expect(await fs.readFile(first.animationSvg,'utf8')).toContain('<animate ');
  const hash=createHash('sha256').update(await fs.readFile(first.dxf)).digest('hex');expect(hash).toBe(first.files['cut.dxf']);
  // Compare immutable geometry cache files across repeated manufacturing exports.
  async function cache(){
   const base=path.join(root,'build/cadcove');const files=await fs.readdir(base,{recursive:true});const result={};
   for(const file of files.filter(f=>/\.(brep|bin)$/.test(f))){const full=path.join(base,file);const st=await fs.stat(full);if(st.isFile())result[file]=[file.includes('/components/')?st.mtimeMs:null,createHash('sha256').update(await fs.readFile(full)).digest('hex')];}
   return result;
  }
  const before=await cache();expect(Object.keys(before).length).toBeGreaterThan(0);
  const second=await run(path.join(root,'second'));expect(second.sourceRevision).toBe(first.sourceRevision);
  expect(await cache()).toEqual(before);expect(await fs.readFile(model,'utf8')).toBe(source);
  await expect(sheetmetalCommand({action:'unfold',workspace:root,input,output:path.join(root,'first')})).rejects.toThrow('already exists');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);
