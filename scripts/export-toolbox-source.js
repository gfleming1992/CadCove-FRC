// Produce a reviewable public-source tree, without this development repository's
// history, team fixtures, recordings, credentials, or untracked files.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,rename,rm,mkdtemp} from 'node:fs/promises';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output')throw Error('Usage: bun scripts/export-toolbox-source.js --output NEW_DIRECTORY');
const root=path.resolve(import.meta.dir,'..'),output=path.resolve(args[1]);
if(output===root||root.startsWith(output+path.sep))throw Error('Output cannot contain the source checkout');
try{await lstat(output);throw Error('Output already exists; choose a new source directory');}catch(error){if(error.code!=='ENOENT')throw error;}
async function git(...args){const p=Bun.spawn(['git','-C',root,...args],{stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw Error(err);return out;}
const policy=JSON.parse(await readFile(path.join(root,'config/toolbox-source.json'),'utf8'));
const safe=p=>typeof p==='string'&&p!==''&&!path.posix.isAbsolute(p)&&!p.includes('\\')&&!p.split('/').some(s=>s==='..'||s==='.')&&!/[\x00-\x1f]/.test(p);
if(policy.schema!==1||!['include','exclude','forbidden'].every(k=>Array.isArray(policy[k])&&policy[k].every(safe)))throw Error('Invalid source export policy');
const matches=(file,rules)=>rules.some(rule=>rule.endsWith('/')?file.startsWith(rule):file===rule);
const revision=(await git('rev-parse','HEAD')).trim();
// A committed snapshot is required: worktree edits must never masquerade as the
// revision recorded in the export. This also makes CI exports reproducible.
if((await git('status','--porcelain','--untracked-files=no')).trim())throw Error('Commit tracked changes before exporting source');
const entries=(await git('ls-files','--stage','-z')).split('\0').filter(Boolean).map(entry=>{const split=entry.indexOf('\t');return {file:entry.slice(split+1),mode:entry.slice(0,6),objectId:entry.slice(0,split).split(' ')[1]};});
const selected=entries.filter(({file})=>matches(file,policy.include)&&!matches(file,policy.exclude));
for(const rule of policy.include)if(!selected.some(({file})=>matches(file,[rule])))throw Error('Source policy matched no tracked files: '+rule);
await mkdir(path.dirname(output),{recursive:true});const staging=await mkdtemp(path.join(path.dirname(output),'.source-export-'));
const files={};let bytes=0;
try{
 for(const {file,mode,objectId} of selected){
  if(!safe(file)||matches(file,policy.forbidden)||!['100644','100755'].includes(mode))throw Error('Unsupported source export entry: '+file);
  const absolute=path.join(root,file),stat=await lstat(absolute);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error('Invalid source file: '+file);
  let data=await readFile(absolute);
  const blobHash=createHash(objectId.length===64?'sha256':'sha1').update('blob '+data.length+'\0').update(data).digest('hex');
  if(blobHash!==objectId)throw Error('Tracked source changed during export: '+file);
  if(file==='package.json'){
   const manifest=JSON.parse(data);delete manifest.scripts['extract:robot'];delete manifest.scripts['extract:field'];
   manifest.scripts['build:native']='bun scripts/build-native-runtime.js';
   data=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  }
  const destination=path.join(staging,file);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,data,{flag:'wx',mode:mode==='100755'?0o755:0o644});
  files[file]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};bytes+=data.length;
 }
 await writeFile(path.join(staging,'source-provenance.json'),JSON.stringify({schema:1,sourceRevision:revision,policy:'config/toolbox-source.json',files},null,2)+'\n');
 await rename(staging,output);
 console.log(JSON.stringify({ok:true,output,sourceRevision:revision,files:selected.length,bytes,published:false}));
}finally{await rm(staging,{recursive:true,force:true});}
