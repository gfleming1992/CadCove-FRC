// Offline engineering tool. No compiler install or third-party build is executed.
import path from 'node:path';
import {readFile,writeFile,mkdir,lstat,rename,rm,mkdtemp,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift(),value=args.shift();if(!['--archives','--output','--jobs'].includes(key)||!value||key in options)throw Error('Usage: bun scripts/prepare-occt-source.js --archives DIRECTORY --output NEW_DIRECTORY [--jobs 4]');options[key]=value;}
if(!options['--archives']||!options['--output'])throw Error('Archives and output are required');
const jobs=Number(options['--jobs']??4);if(!Number.isInteger(jobs)||jobs<1||jobs>32)throw Error('jobs must be an integer from 1 to 32');
const root=path.resolve(import.meta.dir,'..'),output=path.resolve(options['--output']);
const pin=JSON.parse(await readFile(path.join(root,'licenses/occt-source.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function run(argv){const p=Bun.spawn(argv,{stdout:'pipe',stderr:'pipe'});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw Error(argv[0]+' failed: '+err);return out;}
try{await lstat(output);throw Error('Output already exists; preserve edits and choose a new directory');}catch(e){if(e.code!=='ENOENT')throw e;}
// Validate every complete archive before extracting anything. Keep the original
// full archives, including licenses and files outside the compiled include tree.
const archives=[];
for(const a of pin.archives){
 const file=path.resolve(options['--archives'],a.name),s=await lstat(file);
 if(!s.isFile()||s.isSymbolicLink()||s.size>128*1024*1024||sha(await readFile(file))!==a.sha256)throw Error('Source archive checksum/type mismatch: '+a.name);
 const members=(await run(['tar','-tzf',file])).split('\n').filter(Boolean);
 if(!members.length||members.some(m=>!m.startsWith(a.prefix+'/')||m.includes('\\')||m.split('/').some(p=>p==='..'||p==='.')))throw Error('Unexpected archive layout: '+a.name);
 archives.push({...a,file,bytes:s.size});
}
await mkdir(path.dirname(output),{recursive:true});const stage=await mkdtemp(path.join(path.dirname(output),'.occt-source-'));
try{
 await mkdir(path.join(stage,'archives'));
 for(const a of archives){
  const preserved=path.join(stage,'archives',a.name);await copyFile(a.file,preserved);
  if(sha(await readFile(preserved))!==a.sha256)throw Error('Archive changed during copy');
  const destination=path.join(stage,a.destination);await mkdir(destination,{recursive:true});
  await run(['tar','-xzf',preserved,'--strip-components='+a.strip,'-C',destination,...(a.subtree?[a.prefix+'/'+a.subtree]:[])]);
 }
 const patches=[];
 async function replace(file,before,after,reason){const at=path.join(stage,file),original=await readFile(at,'utf8');if(original.split(before).length!==2)throw Error('Patch precondition failed: '+file);const changed=original.replace(before,after);await writeFile(at,changed);patches.push({file,reason,before,after,originalSha256:sha(original),patchedSha256:sha(changed)});}
 await replace('source/3rdparty/rapidjson/rapidjson/document.h',
  'GenericStringRef& operator=(const GenericStringRef& rhs) { s = rhs.s; length = rhs.length; }',
  'GenericStringRef& operator=(const GenericStringRef& rhs) { this->~GenericStringRef(); new (this) GenericStringRef(rhs); return *this; }',
  'Exact upstream scripts/fetch-rapidjson.sh fix for modern Clang');
 await replace('source/xtask/src/build.rs','cmd!(sh, "cmake --build . --parallel").run()?;',
  'cmd!(sh, "cmake --build . --parallel '+jobs+'").run()?;',
  'Bound build concurrency only; no CAD algorithm/compiler-flag change');
 await writeFile(path.join(stage,'source-provenance.json'),JSON.stringify({schema:1,pin,archives:archives.map(({file,...a})=>a),patches,qualification:'Prepared source only; successful rebuild and runtime replacement require separate evidence'},null,2)+'\n');
 await rename(stage,output);
 console.log(JSON.stringify({ok:true,output,jobs,archives:archives.length,patches:patches.length,buildExecuted:false}));
}finally{await rm(stage,{recursive:true,force:true});}
