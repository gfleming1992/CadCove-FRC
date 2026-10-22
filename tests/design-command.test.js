import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {designCommand} from '../lib/design-command.js';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {NativeCadSession} from '../vendor/cad-core/src/native/session.js';
import {projectLayout} from '../vendor/cad-core/extensions/vscode/src/project-files.js';
import {cadCommand} from '../lib/cad-command.js';

test('design capabilities distinguish optional sketch solver from FEA preparation',async()=>{
 expect((await designCommand('cad-sketch',{})).solver).toBe('PlaneGCS');
 expect((await designCommand('cad-analysis',{})).solving).toBe(true);
 await expect(designCommand('cad-analysis',{action:'solve'})).rejects.toThrow('input');
});

test('FEA intake asks for physical facts and preserves evidence files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-analysis-'));
 try{
  const input=path.join(root,'input.json'),output=path.join(root,'output.json');
  await fs.writeFile(input,JSON.stringify({schema:1,analysis:'linearStatic',units:'mm-N-MPa',parts:[{id:'plate'}],outputs:['displacement']}));
  const result=await designCommand('cad-analysis',{action:'prepare',input,output});
  expect(result.inputComplete).toBe(false);expect(result.solved).toBe(false);
  expect(result.questions.map(q=>q.field)).toContain('loads');
  const before=await fs.readFile(output,'utf8');
  await expect(designCommand('cad-analysis',{action:'prepare',input,output})).rejects.toThrow('File exists');
  expect(await fs.readFile(output,'utf8')).toBe(before);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test.skipIf(!process.env.CADCOVE_SKETCH_PYTHON)('sketch CLI solves and CAD edit preserves unrelated disk cache and named anchor',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-sketch-')));
 let session;
 try{
  const python=process.env.CADCOVE_SKETCH_PYTHON;
  const input=path.join(root,'sketch.json'),output=path.join(root,'solution.json');
  const request={schema:1,units:'mm',points:[{id:'a',x:0,y:0},{id:'b',x:40,y:0}],lines:[{id:'ab',a:'a',b:'b'}],constraints:[{id:'fixed',type:'fix',point:'a',x:0,y:0},{id:'level',type:'horizontal',line:'ab'},{id:'span',type:'distance',a:'a',b:'b',value:40}]};
  await fs.writeFile(input,JSON.stringify(request));
  expect((await designCommand('cad-sketch',{action:'solve',input,output,python})).points.b.x).toBeCloseTo(40,6);
  request.constraints.push({id:'conflict',type:'distance',a:'a',b:'b',value:50});await fs.writeFile(input,JSON.stringify(request));
  expect((await designCommand('cad-sketch',{action:'solve',input,output:path.join(root,'conflict.json'),python})).ok).toBe(false);
  await initializeToolbox({workspace:root});
  const model=`import cadquery as cq
from sketch_solver import solve
import json
def build(ctx):
    spacing=json.loads(ctx.files['spacing.json'])
    request=${JSON.stringify({...request,constraints:request.constraints.slice(0,3)})}
    request['constraints'][2]['value']=spacing
    r=solve(request)
    assert r['ok'], r
    x=r['points']['b']['x']
    plate=ctx.component('plate',lambda:cq.Workplane('XY').box(spacing+30,30,4,centered=(False,True,False)).translate((-15,0,0)).cut(cq.Workplane('XY').center(x,0).circle(5).extrude(4)),dependencies=['models.py','spacing.json'],inputs={'x':x})
    bolt=ctx.component('bolt',lambda:cq.Workplane('XY').circle(2).extrude(8),dependencies=['models.py'])
    return [dict(id='plate',shape=plate),dict(id='bolt',shape=bolt)]
`;
  await fs.writeFile(path.join(root,'cad/models.py'),model);await fs.writeFile(path.join(root,'cad/spacing.json'),'40');
  const layout=await projectLayout(root,{sourceDirectory:'cad',buildDirectory:'build/cadcove',entryPoint:'models.py'});
  const create=()=>new NativeCadSession({layout,python,worker:path.resolve('vendor/cad-core/src/native/worker.py')});
  session=create();const first=await session.build();expect(first.timings.components.misses).toBe(2);
  session.dispose();session=create();
  const cached=await session.build();expect(cached.timings.components.misses).toBe(0);
  await fs.writeFile(path.join(root,'cad/spacing.json'),'65');const edited=await session.build();
  expect(edited.timings.components.hits).toBe(1);expect(edited.timings.components.misses).toBe(1);
  const result=await session.inspect("from cad_references import resolve\nface,evidence=resolve(parts,dict(id='bearing',part='plate',kind='cylinder',point=[65,0,2],axis=[0,0,1],radius=5))\nresult=evidence");
  expect(result.result.matches).toBe(1);expect(result.result.point).toEqual([65,0,2]);
 }finally{session?.dispose();await fs.rm(root,{recursive:true,force:true});}
},60000);

test.skipIf(!['CADCOVE_FREECAD','CADCOVE_GMSH','CADCOVE_CCX','CADCOVE_PYTHON'].every(k=>process.env[k]))('FEA CLI connects workspace CAD to a converged axial solve and rejects stale geometry',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-fea-cli-')));
 try{
  await initializeToolbox({workspace:root});
  await fs.writeFile(path.join(root,'cad/models.py'),"import cadquery as cq\ndef build(ctx):\n return [dict(id='beam',shape=cq.Workplane('XY').box(100,10,10,centered=(False,False,False)).val())]\n");
  const script=path.join(root,'hash.py');await fs.writeFile(script,"from cad_references import fingerprint\nresult=fingerprint(parts[0]['shape'])");
  const hash=await cadCommand('cad-inspect',{workspace:root,script});
  const input=path.join(root,'request.json'),output=path.join(root,'result');
  const preparation=path.join(root,'prepare.json');
  await fs.writeFile(preparation,JSON.stringify({schema:1,analysis:'linearStatic',units:'mm-N-MPa',parts:[{id:'beam'}],outputs:['displacement']}));
  const review=await designCommand('cad-analysis',{action:'prepare',workspace:root,input:preparation,output:path.join(root,'review.json')});
  expect(review.request.parts[0].shapeHash).toBe(hash.result);expect(review.sourceRevision).toBe(hash.revision);
  expect(review.request.parts[0].material).toBeUndefined();expect(review.questions.map(q=>q.field)).toContain('loads');
  await expect(designCommand('cad-analysis',{action:'prepare',workspace:root,input:preparation,output:path.join(root,'review.json')})).rejects.toThrow('exist');
  const request={analysis:{...review.request,parts:[{...review.request.parts[0],material:{name:'synthetic steel',source:'analytical regression',youngsModulusMPa:210000,poissonRatio:.3}}],supports:[{id:'fixed',part:'beam',reference:'mount',source:'fixture',restrainedTranslations:[true,true,true]}],loads:[{id:'force',part:'beam',reference:'end',source:'fixture',forceN:[1000,0,0]}]},references:[{id:'mount',part:'beam',kind:'plane',point:[0,5,5],axis:[-1,0,0]},{id:'end',part:'beam',kind:'plane',point:[100,5,5],axis:[1,0,0]}],mesh:{sizesMm:[5,3],relativeTolerance:.01}};
  await fs.writeFile(input,JSON.stringify(request));
  const result=await designCommand('cad-analysis',{action:'solve',workspace:root,input,output});
  expect(result.solved).toBe(true);expect(result.sourceRevision).toBe(hash.revision);expect(result.convergence.passed).toBe(true);
  expect(Math.abs(result.runs.at(-1).maxDisplacementMm/(1000*100/(100*210000))-1)).toBeLessThan(.01);
  await fs.appendFile(path.join(root,'cad/models.py'),"\n# source edit\n");
  request.analysis.parts[0].shapeHash='a'.repeat(64);await fs.writeFile(input,JSON.stringify(request));
  await expect(designCommand('cad-analysis',{action:'solve',workspace:root,input,output:path.join(root,'stale')})).rejects.toThrow('Stale');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);
