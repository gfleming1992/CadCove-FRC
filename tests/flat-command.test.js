import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {flatCommand} from '../lib/flat-command.js';
import {svgPreviewFile} from '../lib/svg-preview.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {startMcpServer,z} from '../lib/mcp-server.js';

test('flat contract and existing SVG display use editor MCP with path validation',async()=>{
 expect((await flatCommand()).formats).toEqual(['dxf','svg']);
 await expect(flatCommand({action:'bad'})).rejects.toThrow('action');
 await expect(flatCommand({action:'export'})).rejects.toThrow('input');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-flat-')));
 let opened;
 const server=await startMcpServer({tools:[{name:'open_svg_preview',description:'Preview',schema:{workspace:z.string(),file:z.string()},run:async a=>{opened=await svgPreviewFile(a.workspace,a.file);return {ok:true,...opened};}}]});
 try{
  await initializeToolbox({workspace:root});
  await fs.mkdir(path.join(root,'build'),{recursive:true});
  const cfg=JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json')));
  const dir=path.join(root,cfg.buildDirectory);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'cadcove-mcp.json'),JSON.stringify({schema:1,workspace:root,endpoint:server.url,token:server.token}));
  const svg=path.join(root,'preview.svg');await fs.writeFile(svg,'<svg xmlns="http://www.w3.org/2000/svg"/>');
  const result=await flatCommand({action:'show',workspace:root,input:svg});expect(result.ok).toBe(true);expect(opened.file).toBe(svg);
  await expect(svgPreviewFile(root,'preview.dxf')).rejects.toThrow('SVG');
  await fs.writeFile(path.join(root,'invalid.svg'),'not SVG');await expect(svgPreviewFile(root,'invalid.svg')).rejects.toThrow('contain SVG');
  const outside=path.join(os.tmpdir(),path.basename(root)+'-outside.svg');await fs.writeFile(outside,'<svg/>');
  try{await expect(svgPreviewFile(root,outside)).rejects.toThrow('inside');}finally{await fs.unlink(outside);}
 }finally{await server.close();await fs.rm(root,{recursive:true,force:true});}
});

test.skipIf(!process.env.CADCOVE_PYTHON)('CLI exports flat geometry, converts DXF without CAD and preserves export if editor is unavailable',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-flat-native-')));
 try{
  await initializeToolbox({workspace:root});
  await fs.writeFile(path.join(root,'cad/models.py'),"import cadquery as cq\ndef build(ctx):\n return [dict(id='plate',shape=cq.Workplane('XY').box(80,50,6,centered=False).faces('>Z').workplane().center(20,25).hole(10))]\n");
  const input=path.join(root,'flat.json');await fs.writeFile(input,JSON.stringify({schema:1,part:'plate',frame:{origin:[0,0,0],xDir:[1,0,0],normal:[0,0,1]}}));
  const cli=path.resolve(import.meta.dir,'../bin/cadcove.js');
  const p=Bun.spawn([process.execPath,cli,'cad-flat','--action','export','--workspace',root,'--input',input,'--output',path.join(root,'flat'),'--show'],{stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  expect(code,err+'\n'+out).toBe(0);const result=JSON.parse(out);
  expect(result.ok).toBe(true);expect(result.holeCount).toBe(1);expect(result.display.ok).toBe(false);
  expect(await fs.readFile(result.svg,'utf8')).toContain('<svg');expect(result.sourceRevision).toBeTruthy();
  await fs.writeFile(path.join(root,'cad/models.py'),'raise RuntimeError("Preview must not run CAD")');
  const preview=await flatCommand({action:'preview',workspace:root,input:result.dxf,output:path.join(root,'preview')});
  expect(preview.widthMm).toBe(80);expect(preview.heightMm).toBe(50);expect(preview.sourceSha256).toBe(result.files['profile.dxf']);
  await expect(flatCommand({action:'preview',workspace:root,input:result.dxf,output:path.join(root,'preview')})).rejects.toThrow('already exists');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);
