import {test,expect} from 'bun:test';
import {mkdtemp,cp,symlink,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {dependencyNotices} from '../lib/dependency-notices.js';

test('runtime notices include locked polyfills and reject changed inventory, provenance and text',async()=>{
 const root=path.resolve(import.meta.dir,'..'),temp=await mkdtemp(path.join(tmpdir(),'cadcove-notices-'));
 try{
  await cp(path.join(root,'licenses'),path.join(temp,'licenses'),{recursive:true});
  await cp(path.join(root,'LICENSE'),path.join(temp,'LICENSE'));
  for(const name of ['node_modules','examples'])await symlink(path.join(root,name),path.join(temp,name),process.platform==='win32'?'junction':'dir');
  // Cargo inventory is independent; this test exercises the bundled runtime.
  const options={cargoMetadata:{packages:[]}},result=await dependencyNotices(temp,options);
  const polyfills=result.inventory.components.filter(c=>c.id.startsWith('embedded:bun-polyfill:'));
  expect(polyfills.length).toBe(103);
  expect(polyfills.reduce((sum,c)=>sum+c.notices.length,0)).toBe(105);
  expect(result.inventory.unresolved.some(c=>c.id.startsWith('embedded:bun-polyfill:'))).toBe(false);
  expect(result.inventory.releaseReady).toBe(false);
  expect(result.inventory.components.find(c=>c.id==='cadcove-original').license).toBe('MIT');
  expect(result.inventory.components.some(c=>c.id==='embedded:bun-nodejs-headers@26.3.0')).toBe(true);
  expect(polyfills.filter(c=>c.name==='bn.js (Bun browser polyfill)').length).toBe(2);
  const occt=result.inventory.components.filter(c=>c.id.startsWith('embedded:occt-in-tree:'));
  expect(occt.length).toBe(5);
  expect(occt.reduce((sum,c)=>sum+c.notices.length,0)).toBe(6);
  for(const text of ['Marcin Sokalski','Regents of the University of California','Bitstream Vera','Leonhard Gruenschloss','The Khronos Group Inc.'])expect(result.text).toContain(text);
  for(const [relative,mutate,error] of [
   ['occt-source.json',text=>{const data=JSON.parse(text);data.archives.find(a=>a.destination==='source/occt').sha256='0'.repeat(64);return JSON.stringify(data);},/OCCT in-tree source and notice pins/],
   ['occt-source.json',text=>{const data=JSON.parse(text);data.inTreeComponents[0].sourceFiles[0]='src/wrong.cpp';return JSON.stringify(data);},/OCCT in-tree notice\/archive mismatch/],
   ['upstream.json',text=>{const data=JSON.parse(text);data.files.find(c=>c.component==='occt-in-tree:delabella').archiveByteRange.length++;return JSON.stringify(data);},/OCCT in-tree notice\/archive mismatch/],
   ['upstream.json',text=>{const data=JSON.parse(text);data.files=data.files.filter(c=>c.file!=='upstream/occt-delabella-cpp-notice.txt');return JSON.stringify(data);},/OCCT in-tree notice\/archive mismatch/],
   ['upstream/occt-flexlexer-notice.txt',text=>text+'changed',/Pinned license text changed/],
   ['bun-polyfills.json',text=>text+' ',/polyfill inventory changed/],
   ['upstream.json',text=>{const data=JSON.parse(text);data.files.find(c=>c.component==='bun-polyfill:assert').archiveSha256='0'.repeat(64);return JSON.stringify(data);},/polyfill notice\/archive mismatch/],
   ['upstream.json',text=>{const data=JSON.parse(text);data.files.find(c=>c.component==='bun-nodejs-headers').sourceRevision='0'.repeat(40);return JSON.stringify(data);},/Node.js header source and notices/],
   ['upstream/'+polyfills[0].notices[0].name,text=>text+'changed',/Pinned license text changed/],
  ]){
   const file=path.join(temp,'licenses',relative),original=await readFile(file,'utf8');
   await writeFile(file,mutate(original));
   await expect(dependencyNotices(temp,options)).rejects.toThrow(error);
   await writeFile(file,original);
  }
 }finally{await rm(temp,{recursive:true,force:true});}
});
