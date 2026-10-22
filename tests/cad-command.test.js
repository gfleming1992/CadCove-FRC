import {test,expect} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializeToolbox} from '../lib/toolbox-project.js';
const python=process.env.CADCOVE_PYTHON;
(python?test:test.skip)('standalone CLI builds and warm session repairs without VS Code',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-cli-'));
 try{
  await initializeToolbox({workspace:root});
  expect(JSON.parse(await fs.readFile(path.join(root,'.cadcove/project.json'),'utf8')).entryPoint).toBe('models.py');
  await fs.writeFile(path.join(root,'cad/models.py'),"import cadquery as cq\nresult=cq.Workplane('XY').box(10,20,30)\n");
  const args=[process.execPath,path.resolve('bin/cadcove.js'),'cad-session','--workspace',root,'--python',python];
  const proc=Bun.spawn(args,{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  proc.stdin.write(JSON.stringify({id:1,op:'build'})+'\n'+JSON.stringify({id:2,op:'inspect',code:'assert False, "constraint failed"'})+'\n'+JSON.stringify({id:3,op:'inspect',code:'result=parts[0]["shape"].Volume()'})+'\n');proc.stdin.end();
  const [stdout,stderr,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
  const rows=stdout.trim().split('\n').map(JSON.parse);expect(code).toBe(0);expect(rows.map(r=>r.id)).toEqual([1,2,3]);expect(rows[0].ok).toBe(true);expect(rows[1].ok).toBe(false);expect(rows[2].result).toBeCloseTo(6000);expect(stderr).toContain('constraint failed');
  expect(JSON.parse(await fs.readFile(path.join(root,'build/cadcove/cad-cache/models.py/status.json'),'utf8')).ok).toBe(true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
},30000);

(python?test:test.skip)('discovery CLI and warm session preserve geometry and review evidence',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cadcove-discovery-'));
 try{
  await initializeToolbox({workspace:root});
  await fs.writeFile(path.join(root,'cad/models.py'),"import cadquery as cq\ndef build(ctx):\n    shaft=ctx.component('shaft',lambda:cq.Workplane('XY').circle(5).extrude(20))\n    bearing=ctx.component('bearing',lambda:cq.Workplane('XY').circle(9).circle(5.1).extrude(5))\n    return [dict(id='shaft',shape=shaft),dict(id='bearing',shape=bearing)]\n");
  const run=async args=>{
   const p=Bun.spawn([process.execPath,path.resolve('bin/cadcove.js'),...args,'--workspace',root,'--python',python],{stdout:'pipe',stderr:'pipe'});
   const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
   if(code)throw Error(err+out);return JSON.parse(out);
  };
  const file=path.join(root,'build/report.json');
  const first=await run(['cad-discover','--output',file]);
  expect(first.candidates).toBe(1);expect(first.cache.featureMisses).toBe(2);
  const report=JSON.parse(await fs.readFile(file,'utf8'));
  const c=report.result.candidates[0];
  const decisions=[{candidateId:c.id,evidenceHash:c.evidenceHash,decision:'confirm',jointType:'revolute',evidenceIndex:0,reason:'Known synthetic bearing fixture'}];
  const decisionFile=path.join(root,'build/decisions.json');await fs.writeFile(decisionFile,JSON.stringify(decisions));
  const second=await run(['cad-discover','--output',path.join(root,'build/report-2.json'),'--decisions',decisionFile]);
  expect(second.cache).toMatchObject({featureMisses:0,pairHits:1});
  expect(second.review.decisions[0].status).toBe('confirmed');expect(second.review.activatesMotion).toBe(false);
  expect(second.revision).toBe(first.revision);
  await expect(run(['cad-discover','--output',file])).rejects.toThrow();
  expect(JSON.parse(await fs.readFile(file,'utf8'))).toEqual(report);
  const p=Bun.spawn([process.execPath,path.resolve('bin/cadcove.js'),'cad-session','--workspace',root,'--python',python],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  p.stdin.write(JSON.stringify({id:1,op:'build'})+'\n'+JSON.stringify({id:2,op:'discover',ids:['shaft','bearing'],decisions})+'\n');p.stdin.end();
  const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  expect(code).toBe(0);const rows=out.trim().split('\n').map(JSON.parse);
  expect(rows[0].timings.components.misses).toBe(0);
  expect(rows[1].result.cache).toMatchObject({featureMisses:0,pairHits:1});
 }finally{await fs.rm(root,{recursive:true,force:true});}
},60000);
