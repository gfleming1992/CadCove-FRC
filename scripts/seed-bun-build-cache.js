// Seed the pinned upstream build's download caches from verified source
// archives. This does not install, extract, patch or execute dependencies.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,lstat,copyFile,rename,rm} from 'node:fs/promises';
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift(),value=args.shift();if(!['--archives','--output'].includes(key)||!value||value.startsWith('--')||key in options)throw Error('Usage: bun scripts/seed-bun-build-cache.js --archives DIRECTORY --output NEW_DIRECTORY');options[key]=value;}
if(Object.keys(options).length!==2)throw Error('Archives and output are required');
const root=path.resolve(import.meta.dir,'..'),output=path.resolve(options['--output']);
const source=JSON.parse(await readFile(path.join(root,'licenses/bun-source.json'),'utf8'));
if(source.revision!=='744846f844374847c902b5e7fd59b4342a51ef99')throw Error('Review changed Bun cache layout');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function absent(){try{await lstat(output);throw Error('Output already exists; choose a new directory');}catch(e){if(e.code!=='ENOENT')throw e;}}
await absent();
const entries=source.nativeGitHubArchives.map(a=>{
 const url=`https://github.com/${a.repository}/archive/${a.revision}.tar.gz`;
 return {...a.archive,cachePath:`tarballs/${a.id}-${sha(url).slice(0,16)}.tar.gz`};
});
entries.push({...source.nodeHeaders.archive,cachePath:'prefetch/by-url/'+sha(source.nodeHeaders.archive.url).slice(0,32)});
for(const entry of entries){
 if(!/^[A-Za-z0-9._-]+$/.test(entry.name)||!/^tarballs\/[A-Za-z0-9._-]+$|^prefetch\/by-url\/[a-f0-9]{32}$/.test(entry.cachePath))throw Error('Invalid source cache path');
 const file=path.resolve(options['--archives'],entry.name),info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size!==entry.bytes||sha(await readFile(file))!==entry.sha256)throw Error('Source archive checksum/type mismatch: '+entry.name);
}
await mkdir(path.dirname(output),{recursive:true});const stage=await mkdtemp(path.join(path.dirname(output),'.bun-cache-'));
try{
 for(const entry of entries){
  const destination=path.join(stage,entry.cachePath);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.resolve(options['--archives'],entry.name),destination);
  if(sha(await readFile(destination))!==entry.sha256)throw Error('Source archive changed during copy');
 }
 await writeFile(path.join(stage,'source-cache.json'),JSON.stringify({schema:1,bunRevision:source.revision,entries},null,2)+'\n');
 await absent();await rename(stage,output);
 console.log(JSON.stringify({ok:true,output,entries:entries.length,cacheDir:output,prefetchDir:path.join(output,'prefetch'),buildExecuted:false}));
}finally{await rm(stage,{recursive:true,force:true});}
