import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {drawingCommand} from '../lib/drawing-command.js';
import {initializeToolbox} from '../lib/toolbox-project.js';

test('drawing contract exposes optional measured exports and rejects incomplete requests',async()=>{
 const cap=await drawingCommand();expect(cap.formats).toEqual(['pdf','svg','FCStd']);expect(cap.reviewRequired).toBe(true);
 await expect(drawingCommand({action:'unknown'})).rejects.toThrow('action');
 await expect(drawingCommand({action:'export'})).rejects.toThrow('input');
 const p=Bun.spawn(['bun','bin/cadcove.js','cad-drawing','--action','capabilities'],{stdout:'pipe',stderr:'pipe'});
 expect(await p.exited).toBe(0);expect(JSON.parse(await new Response(p.stdout).text()).backend).toBe('FreeCAD TechDraw');
});

test.skipIf(!process.env.CADCOVE_DRAWING_FREECAD||!process.env.CADCOVE_PYTHON)('TechDraw CLI exports exact CAD dimensions, pins sources and rejects stale/missing references',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-drawing-')));
 try{
  await initializeToolbox({workspace:root});
  await fs.writeFile(path.join(root,'cad/models.py'),"import cadquery as cq\ndef build(ctx):\n return [dict(id='plate',shape=cq.Workplane('XY').box(80,50,6,centered=(False,False,False)).faces('>Z').workplane().pushPoints([(20,25),(60,25)]).hole(10))]\n");
  const input=path.join(root,'request.json');
  const request={schema:1,part:'plate',title:'Bearing mount plate',notes:['CAD drawing regression'],dimensions:[
   {id:'width',type:'horizontal',view:'top',points:[[0,0,6],[80,0,6]],positionMm:[70,115]},
   {id:'height',type:'vertical',view:'top',points:[[0,0,6],[0,50,6]],positionMm:[40,140]},
   {id:'thickness',type:'vertical',view:'front',points:[[0,0,0],[0,0,6]],positionMm:[40,65]},
   {id:'hole',type:'diameter',view:'top',center:[20,25,6],radiusMm:5,positionMm:[85,162]}
  ]};
  await fs.writeFile(input,JSON.stringify(request));
  const run=output=>drawingCommand({action:'export',workspace:root,input,output:path.join(root,output),freecad:process.env.CADCOVE_DRAWING_FREECAD});
  const result=await run('first');expect(result.ok).toBe(true);expect(result.dimensions.map(x=>x.valueMm)).toEqual([80,50,6,10]);expect(result.scale).toBe(.5);
  expect((await fs.readFile(result.paths['drawing.pdf'])).subarray(0,5).toString()).toBe('%PDF-');
  const svg=await fs.readFile(result.paths['drawing.svg'],'utf8');expect(svg).toContain('Bearing mount plate');expect(svg).toContain('80.00');expect(svg).toContain('10.00');expect(svg).toContain('⌀');
  const source=JSON.parse(await fs.readFile(path.join(root,'first/source.json'),'utf8'));expect(source.shapeHash).toBe(result.shapeHash);expect(source.revision).toBe(result.sourceRevision);
  await expect(run('first')).rejects.toThrow('already exists');
  await fs.writeFile(input,JSON.stringify({...request,shapeHash:'0'.repeat(64)}));await expect(run('stale')).rejects.toThrow('Stale');
  request.dimensions[0].points[1][0]=81;await fs.writeFile(input,JSON.stringify(request));await expect(run('missing')).rejects.toThrow('missing CAD vertex');
  request.dimensions[0].points[1][0]=80;request.scale=10;await fs.writeFile(input,JSON.stringify(request));await expect(run('oversize')).rejects.toThrow('does not fit');
  request.scale=.25;await fs.writeFile(input,JSON.stringify(request));const smaller=await run('quarter');expect(smaller.dimensions.map(x=>x.valueMm)).toEqual([80,50,6,10]);expect(smaller.scale).toBe(.25);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);
