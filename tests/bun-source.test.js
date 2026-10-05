import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';

for(const script of ['prepare-bun-source.js','seed-bun-build-cache.js'])test(script+' refuses existing output and corrupt inputs before writing',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'cadcove-bun-source-'));
 try{
  const output=path.join(temp,'materials'),archives=path.join(temp,'archives');
  await mkdir(output);await writeFile(path.join(output,'keep.txt'),'existing work');await mkdir(archives);
  async function prepare(){
   const child=Bun.spawn([process.execPath,path.resolve(import.meta.dir,'../scripts',script),'--archives',archives,...(script==='prepare-bun-source.js'?['--webkit',path.join(temp,'not-a-checkout')]:[]),'--output',output],{stdout:'pipe',stderr:'pipe'});
   const [code,stderr]=await Promise.all([child.exited,new Response(child.stderr).text()]);return {code,stderr};
  }
  let result=await prepare();expect(result.code).not.toBe(0);expect(result.stderr).toContain('Output already exists');
  expect(await readFile(path.join(output,'keep.txt'),'utf8')).toBe('existing work');
  await rm(output,{recursive:true});
  const source=JSON.parse(await readFile(path.resolve(import.meta.dir,'../licenses/bun-source.json'),'utf8'));
  const archive=script==='prepare-bun-source.js'?source.archive:source.nativeGitHubArchives[0].archive;
  await writeFile(path.join(archives,archive.name),'incorrect source');
  result=await prepare();expect(result.code).not.toBe(0);expect(result.stderr).toContain('Source archive checksum/type mismatch');
  expect((await readdir(temp)).sort()).toEqual(['archives']);
 }finally{await rm(temp,{recursive:true,force:true});}
});
