import {test,expect} from 'bun:test';
import {CadClient} from '../src/core/cad-client.js';
import {compileModel} from '../extensions/vscode/src/compile-model.js';

test('real worker sends component deltas and restores exact geometry before inspection/export',async()=>{
 const client=new CadClient({createWorker:async()=>new Worker(new URL('../src/core/kernel-worker.js',import.meta.url),{type:'module'})});
 const files={
  'model.js':`import a from './a.js';import b from './b.js';
    export default async({cache})=>[
      await cache.part({id:'a',dependencies:['a.js'],color:'#ff0000'},()=>a()),
      await cache.part({id:'b',dependencies:['b.js'],color:'#00ff00'},()=>b())];`,
  'a.js':`import {box} from 'brepjs';export default()=>box(2,3,4);`,
  'b.js':`import {box} from 'brepjs';export default()=>box(3,4,5);`,
 };
 const wasm=await Bun.file('node_modules/occt-wasm/dist/occt-wasm.wasm').arrayBuffer();
 const build=async(revision)=>client.request('build',{revision,entry:'model.js',sourceFiles:files,bundle:await compileModel(files,'model.js'),wasm,profile:true});
 try {
  const first=await build('first');expect(first.timings.components.misses).toBe(2);
  files['b.js']=files['b.js'].replace('3,4,5','4,5,6');
  const second=await build('second');expect(second.timings.components.hits).toBe(1);expect(second.timings.components.misses).toBe(1);
  expect(second.parts[0].positions).toBe(first.parts[0].positions);
  expect(second.parts[1].metrics.volume).toBeCloseTo(120);
  const exact=await client.request('inspect',{code:'return parts.map(p=>adapter.volume(p.shape.wrapped));'},15000);
  expect(exact[0]).toBeCloseTo(24);expect(exact[1]).toBeCloseTo(120);
  expect(await client.request('export')).toContain('ISO-10303-21');
 }finally{client.dispose();}
},30000);
