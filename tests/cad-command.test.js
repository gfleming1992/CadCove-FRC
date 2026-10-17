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
