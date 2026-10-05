// Release-maintainer tool: preserve verified source inputs without installing,
// executing or modifying third-party code. Requires Git and gzip, plus the
// already acquired archives and WebKit Git objects. Never downloads objects.
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,lstat,copyFile,rename,rm} from 'node:fs/promises';

const usage='Usage: bun scripts/prepare-bun-source.js --archives DIRECTORY --webkit GIT_CHECKOUT --output NEW_DIRECTORY';
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift(),value=args.shift();if(!['--archives','--webkit','--output'].includes(key)||!value||value.startsWith('--')||key in options)throw Error(usage);options[key]=value;}
if(Object.keys(options).length!==3)throw Error(usage);
const root=path.resolve(import.meta.dir,'..'),output=path.resolve(options['--output']),webkit=path.resolve(options['--webkit']);
const digest=b=>createHash('sha256').update(b).digest('hex');
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const source=JSON.parse(await readFile(path.join(root,'licenses/bun-source.json'),'utf8'));
if(source.schema!==1||source.version!=='1.4.2'||source.revision!=='744846f844374847c902b5e7fd59b4342a51ef99')throw Error('Review changed Bun source pins');
async function inventory(pin){
 if(!pin||!/^bun-[a-z]+\.json$/.test(pin.file))throw Error('Invalid source inventory');
 const bytes=await readFile(path.join(root,'licenses',pin.file));if(digest(bytes)!==pin.sha256)throw Error('Source inventory hash mismatch: '+pin.file);
 const value=JSON.parse(bytes);if(value.schema!==1||value.bunRevision!==source.revision||!Array.isArray(value.components))throw Error('Source inventory revision mismatch');return value;
}
const rust=await inventory(source.rustDependencyInventory),polyfills=await inventory(source.polyfillDependencyInventory);
const archives=[
 {relative:source.archive.name,...source.archive},
 {relative:source.nodeHeaders.archive.name,...source.nodeHeaders.archive},
 ...source.nativeGitHubArchives.map(a=>({relative:a.archive.name,...a.archive,url:a.archiveUrl})),
 ...rust.components.map(c=>({relative:'bun-rust/'+c.archive.name,...c.archive})),
 ...polyfills.components.map(c=>({relative:'bun-polyfills/'+c.archive.name,...c.archive})),
 {relative:source.buildToolchain.standardLibrary.sourceArchive.name,...source.buildToolchain.standardLibrary.sourceArchive},
];
const safe=relative=>typeof relative==='string'&&relative.length>0&&!/[\\:\x00-\x1f\x7f]/.test(relative)&&!relative.startsWith('/')&&!relative.split('/').some(p=>!p||p==='.'||p==='..');
async function absent(file){try{await lstat(file);throw Error('Output already exists; choose a new directory');}catch(error){if(error.code!=='ENOENT')throw error;}}
await absent(output);
if(new Set(archives.map(a=>a.relative)).size!==archives.length)throw Error('Duplicate source archive');
for(const archive of archives){
 if(!safe(archive.relative)||!/^[a-f0-9]{64}$/.test(archive.sha256)||!Number.isSafeInteger(archive.bytes)||archive.bytes<=0)throw Error('Invalid source archive pin');
 const file=path.resolve(options['--archives'],archive.relative),info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size!==archive.bytes||await hashFile(file)!==archive.sha256)throw Error('Source archive checksum/type mismatch: '+archive.relative);
}
const nullFile=process.platform==='win32'?'NUL':'/dev/null';
const gitEnv={...process.env,GIT_NO_LAZY_FETCH:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:nullFile};
async function run(argv,{stdout='pipe',stdin='ignore',env=process.env}={}){
 const child=Bun.spawn(argv,{stdout,stdin,stderr:'pipe',env});
 const [out,err,code]=await Promise.all([stdout==='pipe'?new Response(child.stdout).text():Promise.resolve(''),new Response(child.stderr).text(),child.exited]);
 if(code)throw Error(argv[0]+' failed: '+err);return out;
}
const gitArgs=['git','-C',webkit,'-c','core.attributesFile='+nullFile,'-c','tar.umask=0002'];
async function git(...args){return run([...gitArgs,...args],{env:gitEnv});}
if((await git('rev-parse',source.webkit.revision+'^{commit}')).trim()!==source.webkit.revision)throw Error('Missing pinned WebKit commit');
// Same source selection used by the qualified JSC build. Include root and
// ancestor files as sparse-checkout does; archive from the commit, not disk.
const selections=['.github','Configurations','Source/JavaScriptCore','Source/ThirdParty','Source/WTF','Source/bmalloc','Source/cmake','Tools/Scripts','Tools/TestWebKitAPI','WebKitLibraries','icu','metadata','resources','scripts'];
function entries(text){return text.split('\0').filter(Boolean).map(line=>{const at=line.indexOf('\t'),[mode,type,object]=line.slice(0,at).split(' ');return {path:line.slice(at+1),mode,type,object};});}
for(const parent of ['', 'Source/', 'Tools/']){
 const files=entries(await git('ls-tree','-z',source.webkit.revision,...(parent?[parent]:[])));
 for(const entry of files)if(entry.type==='blob')selections.push(entry.path);
}
selections.sort();
const selected=entries(await git('ls-tree','-r','-z',source.webkit.revision,'--',...selections));
if(!selected.length||selected.some(e=>!safe(e.path)||!['100644','100755','120000'].includes(e.mode)||e.type!=='blob'))throw Error('Unexpected WebKit source entry or submodule; review source selection');
await mkdir(path.dirname(output),{recursive:true});const stage=await mkdtemp(path.join(path.dirname(output),'.bun-source-'));
try{
 for(const archive of archives){
  const dest=path.join(stage,'archives',archive.relative);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.resolve(options['--archives'],archive.relative),dest);
  if(await hashFile(dest)!==archive.sha256)throw Error('Source archive changed during copy: '+archive.relative);
 }
 const tar=path.join(stage,'webkit.tar'),relative='bun-webkit-'+source.webkit.revision+'.tar.gz',compressed=path.join(stage,'archives',relative);
 // git archive prefetches blobs from a partial clone before applying pathspecs.
 // Construct the selected tree in a temporary bare repository instead. Its
 // object store reads the source store but never writes there or has a remote.
 const exportGit=path.join(stage,'.webkit-git'),indexInput=path.join(stage,'.webkit-index-input');
 await run(['git','init','--bare','--quiet',exportGit],{env:gitEnv});
 // Source archives must preserve Git blob bytes, including BAT line endings,
 // instead of applying checkout filters or omitting export-ignored files.
 await writeFile(path.join(exportGit,'info/attributes'),'* -text -eol -filter -ident -working-tree-encoding -export-subst -export-ignore\n');
 const objectStore=path.resolve(webkit,(await git('rev-parse','--git-path','objects')).trim());
 if(/[\r\n]/.test(objectStore))throw Error('Unsupported Git object-store path');
 await writeFile(path.join(exportGit,'objects/info/alternates'),objectStore+'\n');
 const exportEnv={...gitEnv,GIT_INDEX_FILE:path.join(stage,'.webkit-index')};
 const exportArgs=['git','--git-dir='+exportGit,'-c','core.attributesFile='+nullFile,'-c','tar.umask=0002'];
 await writeFile(indexInput,selected.map(e=>`${e.mode} ${e.object}\t${e.path}\0`).join(''));
 await run([...exportArgs,'update-index','-z','--index-info'],{env:exportEnv,stdin:Bun.file(indexInput)});
 const exportTree=(await run([...exportArgs,'write-tree'],{env:exportEnv})).trim();
 const timestamp=(await git('show','-s','--format=%ct',source.webkit.revision)).trim();
 if(!/^[a-f0-9]{40}$/.test(exportTree)||!/^\d+$/.test(timestamp))throw Error('Invalid selected WebKit tree metadata');
 await run([...exportArgs,'archive','--format=tar','--mtime=@'+timestamp,'--prefix=webkit/','--output='+tar,exportTree],{env:exportEnv});
 for(const file of [exportGit,indexInput,path.join(stage,'.webkit-index')])await rm(file,{recursive:true,force:true});
 await run(['gzip','-n','-c',tar],{stdout:Bun.file(compressed)});await rm(tar);
 const webkitArchive={relative,bytes:(await lstat(compressed)).size,sha256:await hashFile(compressed),repository:'https://github.com/'+source.webkit.repository,revision:source.webkit.revision,exportTree,timestamp:Number(timestamp),selections,selectedGitEntries:selected.length,scope:'Exact Git blob bytes for the JSC build-source subset, without checkout filters or export-ignore exclusions; excludes Git history, working-tree changes and unrelated WebKit browser sources'};
 await writeFile(path.join(stage,'webkit-git-entries.json'),JSON.stringify(selected,null,2)+'\n');
 const pins=JSON.parse(await readFile(path.join(root,'licenses/upstream.json'),'utf8'));
 const notices=pins.files.filter(p=>p.component==='bun'||p.component.startsWith('bun-'));
 const files=['bun-source.json','bun-rust.json','bun-polyfills.json',source.relinkProbe.patch,...notices.map(p=>p.file)];
 const preserved={};
 for(const relative of files){
  if(!safe(relative))throw Error('Invalid source notice path');
  const bytes=await readFile(path.join(root,'licenses',relative));const expected=notices.find(p=>p.file===relative)?.sha256??(relative===source.relinkProbe.patch?source.relinkProbe.sha256:null);
  if(expected&&digest(bytes)!==expected)throw Error('Source notice/patch changed: '+relative);
  const dest=path.join(stage,'licenses',relative);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes);preserved['licenses/'+relative]=digest(bytes);
 }
 await writeFile(path.join(stage,'licenses/upstream.json'),JSON.stringify({schema:1,files:notices},null,2)+'\n');
 await copyFile(path.join(root,'docs/BUN-REBUILD.md'),path.join(stage,'BUN-REBUILD.md'));
 await writeFile(path.join(stage,'source-provenance.json'),JSON.stringify({schema:1,bunRevision:source.revision,archives,webkitArchive,preserved,qualification:'Verified source input collection. Preparation does not execute a build; build qualification is separate evidence. This is not a completed distribution/legal audit. Compiler binaries, platform SDKs and Bun build-tool npm dependencies are not included.'},null,2)+'\n');
 await writeFile(path.join(stage,'README.txt'),'CadCove Bun runtime source materials\n\nSee BUN-REBUILD.md and source-provenance.json. Original source archives are preserved. Extract the Bun archive and archives/'+relative+' into separate source directories; the WebKit archive has a webkit/ prefix. Set BUN_WEBKIT_PATH to the extracted webkit directory and GIT_SHA to the pinned Bun revision.\n\nNo compiler/toolchain is installed and no third-party source is executed by preparation. The included diagnostic relink patch is optional qualification material, not a production patch. This collection alone does not prove offline rebuildability or complete source/license coverage.\n');
 await absent(output);await rename(stage,output);
 console.log(JSON.stringify({ok:true,output,sourceArchives:archives.length+1,sourceBytes:archives.reduce((sum,a)=>sum+a.bytes,0)+webkitArchive.bytes,webkitArchiveSha256:webkitArchive.sha256,buildExecuted:false,published:false}));
}finally{await rm(stage,{recursive:true,force:true});}
