import {test,expect} from 'bun:test';
import {chooseCanvas,canvasMotionInput} from '../lib/canvas-router.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('common commands follow the active canvas and explicit targets override it',()=>{
 const cad={kind:'cad',entry:'models.py',active:false},field={kind:'field',active:true};
 expect(chooseCanvas([cad,field],{})).toBe(field);expect(chooseCanvas([cad,field],{target:'cad'})).toBe(cad);expect(chooseCanvas([cad,field],{entry:'models.py'})).toBe(cad);
 expect(chooseCanvas([{...cad,active:true},{...field,active:false}],{}).kind).toBe('cad');
});
test('ambiguous or absent canvases fail instead of targeting the wrong model',()=>{
 const cs=[{kind:'cad',entry:'a.py'},{kind:'cad',entry:'b.py'},{kind:'field'}];
 expect(()=>chooseCanvas(cs,{})).toThrow('Multiple');expect(()=>chooseCanvas(cs,{target:'cad'})).toThrow('Multiple');expect(chooseCanvas(cs,{entry:'b.py'}).entry).toBe('b.py');expect(()=>chooseCanvas([])).toThrow('Open');expect(()=>chooseCanvas(cs,{target:'invalid'})).toThrow();
});
test('solved motion loads large workspace artifacts while rejecting unsafe or conflicting inputs',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-motion-')),root=path.join(temp,'workspace');await fs.mkdir(root);
 try{
  const solution={schema:1,frames:Array.from({length:2000},(_,i)=>({time:i/60,angles:{wheel:i*10}}))};
  await fs.writeFile(path.join(root,'motion.json'),JSON.stringify(solution));
  const command={action:'play-solved',solutionFile:'motion.json'};
  expect((await fs.stat(path.join(root,'motion.json'))).size).toBeGreaterThan(65536);
  expect(await canvasMotionInput(root,'motion',command)).toEqual({action:'play-solved',solution});
  expect(await canvasMotionInput(root,'motion',{action:'pause'})).toEqual({action:'pause'});
  await expect(canvasMotionInput(root,'motion',{...command,solution})).rejects.toThrow('cannot be combined');
  await expect(canvasMotionInput(root,'motion',{...command,action:'rotate'})).rejects.toThrow('play-solved');
  await fs.writeFile(path.join(temp,'outside.json'),'{}');
  await expect(canvasMotionInput(root,'motion',{...command,solutionFile:'../outside.json'})).rejects.toThrow('inside the workspace');
  if(process.platform!=='win32'){
   await fs.symlink(path.join(temp,'outside.json'),path.join(root,'link.json'));
   await expect(canvasMotionInput(root,'motion',{...command,solutionFile:'link.json'})).rejects.toThrow('inside the workspace');
  }
  await fs.writeFile(path.join(root,'bad.json'),'{');
  await expect(canvasMotionInput(root,'motion',{...command,solutionFile:'bad.json'})).rejects.toThrow();
  const big=await fs.open(path.join(root,'big.json'),'w');await big.truncate(32*1024*1024+1);await big.close();
  await expect(canvasMotionInput(root,'motion',{...command,solutionFile:'big.json'})).rejects.toThrow('32 MiB');
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
