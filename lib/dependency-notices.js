// Release-time inventory. Runs against installed, locked dependencies; never
// downloads license text or executes a package's install/build scripts.
import path from 'node:path';
import {readFile,readdir,stat,lstat,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {rustRelease} from './native-build-provenance.js';
const digest=data=>createHash('sha256').update(data).digest('hex');
const isNotice=name=>/^(licen[sc]e|copying|notice|unlicense)([.\-_]|$)/i.test(name);
export async function dependencyNotices(root,{cargoMetadata,bunVersion=Bun.version,includeBunRuntime=true}={}){
 const pinned=JSON.parse(await readFile(path.join(root,'licenses/upstream.json'),'utf8'));
 if(pinned.schema!==1||!Array.isArray(pinned.files))throw Error('Invalid pinned license inventory');
 const upstream=[];
 for(const item of pinned.files){
  if(!/^upstream\/[A-Za-z0-9._-]+$/.test(item.file)||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('Invalid pinned license document');
  const bytes=await readFile(path.join(root,'licenses',item.file));if(digest(bytes)!==item.sha256)throw Error('Pinned license text changed: '+item.file);
  upstream.push({...item,text:bytes.toString('utf8')});
 }
 const components=[],unresolved=[];
 async function notices(directory,extra=[]){
  const names=[...new Set([...(await readdir(directory)).filter(isNotice),...extra])].sort();const result=[];
  for(const name of names){
   const file=path.resolve(directory,name);if(!file.startsWith(directory+path.sep))throw Error('License file must stay inside its dependency package');
   const info=await lstat(file);if(info.isSymbolicLink())throw Error('License file must not be a symbolic link');
   if(info.isFile()){if(info.size>4*1024*1024)throw Error('License text exceeds review limit');const data=await readFile(file);result.push({name:path.basename(name),sha256:digest(data),text:data.toString('utf8')});}
  }
  return result;
 }
 function pinnedNotices(name,version){return upstream.filter(p=>p.component===name&&p.version===version).map(p=>({name:path.basename(p.file),sha256:p.sha256,text:p.text,source:p.url,...(p.sourceLicense?{sourceLicense:p.sourceLicense,licenseTextPublisher:p.licenseTextPublisher}:{}),...(p.gitBlob?{gitBlob:p.gitBlob}:{}),...(p.archiveEntry?{archiveEntry:p.archiveEntry,archiveSha256:p.archiveSha256}:{}),...(p.archiveByteRange?{archiveByteRange:p.archiveByteRange}:{})}));}
 function add(component){
  if(!component.license)unresolved.push({id:component.id,reason:'No declared license'});
  if(!component.notices.length)unresolved.push({id:component.id,reason:'No license/notice text in the package or pinned supplement'});
  components.push(component);
 }
 // Cargo metadata includes the feature-resolved graph (including build and
 // platform-specific dependencies). This is a conservative source inventory,
 // not a claim that every crate contributes machine code to every platform.
 if(!cargoMetadata){
  const p=Bun.spawn(['cargo','metadata','--locked','--format-version','1','--features','composite-compact'],{cwd:root,stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw Error('Cannot inventory locked native dependencies: '+err);cargoMetadata=JSON.parse(out);
 }
 for(const pkg of cargoMetadata.packages){
  const directory=path.dirname(pkg.manifest_path),texts=await notices(directory,pkg.license_file?[pkg.license_file]:[]);
  if(!texts.length)texts.push(...pinnedNotices(pkg.name==='profiling-procmacros'?'profiling':pkg.name,pkg.version));
  add({id:'cargo:'+pkg.name+'@'+pkg.version,ecosystem:'cargo',name:pkg.name,version:pkg.version,license:pkg.license??null,source:pkg.repository??pkg.source??null,modified:pkg.source===null&&pkg.name!=='instantcad-sim',notices:texts});
 }
 async function packageDirectory(name,from){
  let current=from;
  while(current===root||current.startsWith(root+path.sep)){
   const directory=path.join(current,'node_modules',name);
   try{await stat(path.join(directory,'package.json'));return directory;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(current===root)break;current=path.dirname(current);
  }
  throw Error('Missing installed dependency for notices: '+name);
 }
 const seen=new Set();
 async function npm(name,from=root){
  const directory=await packageDirectory(name,from);if(seen.has(directory))return;seen.add(directory);
  const pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));let texts=await notices(directory);
  if(!texts.length)texts=pinnedNotices(pkg.name,pkg.version);
  if(!texts.length&&pkg.name.startsWith('@esbuild/')){
    const parent=await packageDirectory('esbuild',root),meta=JSON.parse(await readFile(path.join(parent,'package.json'),'utf8'));
    if(meta.version!==pkg.version)throw Error('esbuild platform/license version mismatch');texts=await notices(parent);
  }
  const source=typeof pkg.repository==='object'?pkg.repository.url:pkg.repository;
  add({id:'npm:'+pkg.name+'@'+pkg.version,ecosystem:'npm',name:pkg.name,version:pkg.version,license:pkg.license??null,source:source??null,notices:texts});
  for(const dependency of Object.keys(pkg.dependencies??{}))await npm(dependency,directory);
 }
 await npm('@modelcontextprotocol/sdk');await npm('zod');await npm('meshoptimizer');
 if(!includeBunRuntime){
  // Preserve the bundler's own MIT attribution for generated JavaScript helpers.
  // This is compiler output, not the Bun interpreter or its embedded libraries.
  add({id:'generated:javascript-bundler@'+bunVersion,ecosystem:'generated-source',name:'Bun-generated JavaScript helpers',version:bunVersion,license:'MIT',source:'https://github.com/oven-sh/bun',scope:'Generated JavaScript only; no Bun binary or embedded native libraries',notices:pinnedNotices('bun',bunVersion)});
 }
 // CAD Python dependencies are installed by the user, not redistributed here.
 // The editor JavaScript is bundled; no browser CAD kernel or runtime compiler.
 if(includeBunRuntime){
 const bunText=pinnedNotices('bun',bunVersion);
 if(!bunText.length)throw Error('Review/pin bundled Bun notices for version '+bunVersion);
 const bunSource=JSON.parse(await readFile(path.join(root,'licenses/bun-source.json'),'utf8'));
 if(bunSource.schema!==1||bunSource.version!==bunVersion||bunSource.revision!=='744846f844374847c902b5e7fd59b4342a51ef99')throw Error('Review Bun source archive pins for this version');
 add({id:'runtime:bun@'+bunVersion,ecosystem:'runtime',name:'Bun compiled runtime',version:bunVersion,license:'MIT plus bundled-component licenses',source:'https://github.com/oven-sh/bun/tree/'+bunSource.revision,sourceArchive:bunSource.archive,notices:bunText});
 const nodeHeaders=bunSource.nodeHeaders,nodeNotices=pinnedNotices('bun-nodejs-headers',nodeHeaders?.version);
 const nodeRecords=upstream.filter(p=>p.component==='bun-nodejs-headers'&&p.version===nodeHeaders?.version);
 if(nodeHeaders?.version!=='26.3.0'||nodeHeaders.sourceRevision!=='b7e6a5d37e7a14ef0f2cc95214b95d66c4081415'||nodeNotices.length!==1||nodeRecords.some(p=>p.supplementForArchiveSha256!==nodeHeaders.archive.sha256||p.sourceRevision!==nodeHeaders.sourceRevision||!/^[a-f0-9]{40}$/.test(p.gitBlob??'')))throw Error('Review Bun Node.js header source and notices');
 add({id:'embedded:bun-nodejs-headers@'+nodeHeaders.version,ecosystem:'embedded',name:'Node.js compatibility headers for Bun',version:nodeHeaders.version,license:'MIT and bundled-source notices retained from the matching Node.js release',source:'https://github.com/nodejs/node/tree/'+nodeHeaders.sourceRevision,sourceArchive:nodeHeaders.archive,scope:nodeHeaders.scope,notices:nodeNotices});
 if(!Array.isArray(bunSource.inTreeComponents)||bunSource.inTreeComponents.length!==4)throw Error('Review Bun in-tree notice inventory');
 for(const dependency of bunSource.inTreeComponents){
  const records=upstream.filter(p=>p.component==='bun-in-tree:'+dependency.id&&p.version===bunSource.revision);
  if(!records.length||records.length!==dependency.noticeFiles.length||records.some(p=>!dependency.noticeFiles.includes(p.file)||p.archiveSha256!==bunSource.archive.sha256||!p.archiveEntry))throw Error('Bun in-tree notice/archive mismatch: '+dependency.id);
  add({id:'embedded:bun-in-tree:'+dependency.id+'@'+bunSource.revision,ecosystem:'embedded',name:dependency.name,version:bunSource.revision,license:dependency.license,source:'https://github.com/oven-sh/bun/tree/'+bunSource.revision,sourceArchive:bunSource.archive,scope:dependency.scope,notices:pinnedNotices('bun-in-tree:'+dependency.id,bunSource.revision)});
 }
 // Conservative build-source inventory, including platform-specific libraries
 // and source-distribution notices. This is not a linked-binary dependency map.
 const nativeIds=new Set();
 for(const dependency of bunSource.nativeGitHubArchives){
  const {id,revision,archive,noticeFiles}=dependency;
  if(nativeIds.has(id)||!archive||!/^[a-f0-9]{64}$/.test(archive.sha256)||!Number.isSafeInteger(archive.bytes)||archive.bytes<=0||!dependency.licenseSummary||!Array.isArray(noticeFiles)||!noticeFiles.length)throw Error('Review Bun native source/notice pins: '+id);
  nativeIds.add(id);
  const records=upstream.filter(p=>p.component==='bun-'+id&&p.version===revision);
  if(new Set(noticeFiles).size!==noticeFiles.length||records.length!==noticeFiles.length||records.some(p=>!noticeFiles.includes(p.file)||p.archiveSha256!==archive.sha256||!p.archiveEntry))throw Error('Bun native notice/archive mismatch: '+id);
  add({id:'embedded:bun-'+id+'@'+revision,ecosystem:'embedded',name:id+' (Bun build source)',version:revision,license:dependency.licenseSummary,source:'https://github.com/'+dependency.repository+'/tree/'+revision,sourceArchive:{...archive,url:dependency.archiveUrl},sourcePatches:dependency.referencedPatches,scope:'Build-source declaration; platform linkage and complete file-level notice review pending',notices:pinnedNotices('bun-'+id,revision)});
 }
 if(nativeIds.size!==21)throw Error('Review changed Bun native dependency inventory');
 const webkit=bunSource.webkit,webkitNotices=pinnedNotices('bun-webkit',webkit.revision);
 if(webkit.revision!=='2e2aa2290fac856d6f451ceacb58f7f5b44dd057'||!Array.isArray(webkit.noticeFiles)||webkit.noticeFiles.length!==16||webkitNotices.length!==16||webkitNotices.some(n=>!webkit.noticeFiles.includes('upstream/'+n.name)||!/^[a-f0-9]{40}$/.test(n.gitBlob??'')))throw Error('Review Bun WebKit source and notice pins');
 add({id:'embedded:bun-webkit@'+webkit.revision,ecosystem:'embedded',name:'Bun JavaScriptCore, WTF and bmalloc build sources',version:webkit.revision,license:'LGPL-2.0 and file-specific permissive/third-party terms; preserved notice texts are not a complete file-level review',source:'https://github.com/'+webkit.repository+'/tree/'+webkit.revision,scope:'Local macOS rebuild/relink qualified; distributable source bundle and file-level notice review pending',notices:webkitNotices});
 const polyfillBytes=await readFile(path.join(root,'licenses/bun-polyfills.json'));
 if(bunSource.polyfillDependencyInventory?.file!=='bun-polyfills.json'||digest(polyfillBytes)!==bunSource.polyfillDependencyInventory.sha256)throw Error('Bun polyfill inventory changed; review source pins');
 const polyfills=JSON.parse(polyfillBytes);
 if(polyfills.schema!==1||polyfills.bunRevision!==bunSource.revision||!Array.isArray(polyfills.components)||polyfills.components.length!==103)throw Error('Review Bun polyfill dependency inventory');
 for(const dependency of polyfills.components){
  const {name,version,archive,noticeFiles}=dependency,records=upstream.filter(p=>p.component==='bun-polyfill:'+name&&p.version===version);
  if(!archive||!/^[a-f0-9]{64}$/.test(archive.sha256)||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(archive.integrity)||!Number.isSafeInteger(archive.bytes)||archive.bytes<=0||!Array.isArray(noticeFiles)||!noticeFiles.length||new Set(noticeFiles).size!==noticeFiles.length||records.length!==noticeFiles.length||records.some(p=>!noticeFiles.includes(p.file)||p.archiveSha256!==archive.sha256||!p.archiveEntry))throw Error('Bun polyfill notice/archive mismatch: '+name+'@'+version);
  add({id:'embedded:bun-polyfill:'+name+'@'+version,ecosystem:'embedded',name:name+' (Bun browser polyfill)',version,license:dependency.license,source:dependency.source,sourceArchive:archive,scope:polyfills.scope,notices:pinnedNotices('bun-polyfill:'+name,version)});
 }
 const polyfillHeaders=pinnedNotices('bun-polyfill-in-tree',bunSource.revision);
 if(!Array.isArray(polyfills.inTreeNoticeFiles)||polyfillHeaders.length!==7||polyfillHeaders.some(p=>!polyfills.inTreeNoticeFiles.includes('upstream/'+p.name)||p.archiveSha256!==bunSource.archive.sha256||!p.archiveByteRange))throw Error('Review Bun in-tree polyfill headers');
 add({id:'embedded:bun-polyfill-in-tree@'+bunSource.revision,ecosystem:'embedded',name:'Bun in-tree browser polyfill attributions',version:bunSource.revision,license:'MIT and BSD-3-Clause source-header declarations; complete file-level review remains',source:'https://github.com/oven-sh/bun/tree/'+bunSource.revision+'/src/node-fallbacks',sourceArchive:bunSource.archive,scope:'Exact leading comments from seven vendored or adapted files; short attribution headers do not replace complete license grants',notices:polyfillHeaders});
 const rustInventoryBytes=await readFile(path.join(root,'licenses/bun-rust.json'));
 if(bunSource.rustDependencyInventory?.file!=='bun-rust.json'||digest(rustInventoryBytes)!==bunSource.rustDependencyInventory.sha256)throw Error('Bun Rust dependency inventory changed; review source pins');
 const bunRust=JSON.parse(rustInventoryBytes);
 if(bunRust.schema!==1||bunRust.bunRevision!==bunSource.revision||!Array.isArray(bunRust.components))throw Error('Invalid Bun Rust dependency inventory');
 for(const dependency of bunRust.components){
  const {name,version,archive,noticeFiles}=dependency,records=upstream.filter(p=>p.component==='bun-rust:'+name&&p.version===version);
  const validProvenance=p=>{
   if(p.archiveSha256===archive.sha256&&p.archiveEntry)return true;
   if(p.supplementForArchiveSha256!==archive.sha256)return false;
   if(/^[a-f0-9]{40}$/.test(p.gitBlob??'')&&/^[a-f0-9]{40}$/.test(p.sourceRevision??''))return true;
   // This crate embeds the MPL grant in its source header but omits the full
   // license. Preserve the separately pinned text from the license steward.
   return dependency.license==='MPL-2.0'&&p.sourceLicense==='MPL-2.0'&&p.licenseTextPublisher==='Mozilla Foundation'&&p.url==='https://www.mozilla.org/media/MPL/2.0/index.txt';
  };
  if(!Array.isArray(noticeFiles)||new Set(noticeFiles).size!==noticeFiles.length||records.length!==noticeFiles.length||records.some(p=>!noticeFiles.includes(p.file)||!validProvenance(p)))throw Error('Bun Rust notice/archive mismatch: '+name);
  add({id:'embedded:bun-rust:'+name+'@'+version,ecosystem:'embedded',name:name+' (Bun Rust dependency)',version,license:dependency.license,source:dependency.source,sourceArchive:archive,scope:bunRust.scope,notices:pinnedNotices('bun-rust:'+name,version)});
 }
 const bunRustToolchain=bunSource.buildToolchain,bunStdNotices=pinnedNotices('bun-rust-std',bunRustToolchain.rust);
 if(bunRustToolchain.rust!=='nightly-2026-07-20'||bunRustToolchain.rustCommit!=='9f36de775bc636c8e88c31a173c2bcb6995956a0'||bunStdNotices.length!==1||bunStdNotices[0].archiveSha256!==bunRustToolchain.standardLibrary?.compilerDistribution?.sha256)throw Error('Review Bun Rust standard-library source and notices');
 add({id:'runtime:bun-rust-std@'+bunRustToolchain.rust,ecosystem:'runtime',name:'Rust standard library used by the source-built Bun runtime',version:bunRustToolchain.rust,license:'MIT OR Apache-2.0; exceptions and bundled dependencies described in upstream copyright document',source:'https://github.com/rust-lang/rust/tree/'+bunRustToolchain.rustCommit,sourceArchive:bunRustToolchain.standardLibrary.sourceArchive,scope:'Reviewed Bun source-build toolchain; distinct from the physics runtime compiler',notices:bunStdNotices});
 }
 const rustText=pinnedNotices('rust-std',rustRelease.version);
 if(!rustText.length)throw Error('Review/pin Rust standard library notices for '+rustRelease.version);
 add({id:'runtime:rust-std@'+rustRelease.version,ecosystem:'runtime',name:'Rust standard library and bundled dependencies',version:rustRelease.version,license:'MIT OR Apache-2.0; exceptions and bundled dependencies described in upstream copyright document',source:'https://github.com/rust-lang/rust/tree/'+rustRelease.commit,notices:rustText});
 const helperRoot=path.join(root,'examples/training-robot/vendor/limelight'),helper=JSON.parse(await readFile(path.join(helperRoot,'upstream.json'),'utf8'));
 for(const file of ['LimelightHelpers.java','LICENSE'])if(digest(await readFile(path.join(helperRoot,file)))!==helper.files[file])throw Error('Training Limelight source pin changed: '+file);
 add({id:'example:limelight-helpers@'+helper.version,ecosystem:'example-source',name:'LimelightHelpers (training example)',version:helper.version,license:'MIT',source:helper.repository+'/tree/'+helper.revision,notices:await notices(helperRoot)});
 // Explicit gates: upstream metadata/text collection cannot establish complete
 // binary correspondence or fulfill source/relinking requirements by itself.
 if(includeBunRuntime)unresolved.push({id:'runtime:bun@'+bunVersion,reason:'Audit all embedded component notices and corresponding source/relinking materials; upstream LICENSE.md is an inventory, not a complete license bundle'});
 add({id:'cadcove-original',ecosystem:'original-source',name:'CadCove original toolbox and CAD core',version:'0.1.0',license:'MIT',source:null,notices:await notices(root,['LICENSE'])});
 if(includeBunRuntime)unresolved.push({id:'cadcove-publication',reason:'Standalone Bun distribution review remains pending'});
 components.sort((a,b)=>a.id.localeCompare(b.id));
 if(!includeBunRuntime){
  // Reviewed license expressions in the locked distributable graph. A dependency
  // update with new terms must be reviewed, not blessed by merely having a notice.
  const reviewed=new Set(['MIT','Apache-2.0','MIT OR Apache-2.0','Apache-2.0 OR MIT','MIT/Apache-2.0','MIT OR Unlicense','Unlicense OR MIT','ISC','BSD-2-Clause','BSD-3-Clause','0BSD','Zlib','CC0-1.0','(MIT OR Apache-2.0) AND Unicode-3.0','MIT OR Apache-2.0; exceptions and bundled dependencies described in upstream copyright document']);
  reviewed.add('Zlib OR Apache-2.0 OR MIT'); // bytemuck, safe_arch and wide: MIT option retained.
  for(const c of components)if(!reviewed.has(c.license))unresolved.push({id:c.id,reason:'Review changed license expression: '+c.license});
 }
 const inventory={schema:1,target:process.platform+'-'+process.arch,profile:includeBunRuntime?'embedded-bun':'external-bun',scope:'Locked native dependency graph, Rust standard library, bundled CLI JavaScript dependencies and training-example Limelight helper source. '+(includeBunRuntime?'Includes compiled Bun runtime. ':'Bun is installed separately and is not redistributed. ')+'Native CadQuery and robot/vendor SDK binaries are installed separately.',releaseReady:unresolved.length===0,unresolved,components:components.map(({notices,...component})=>({...component,notices:notices.map(({text,...notice})=>notice)}))};
 let text='CadCove third-party dependency notices\n\nThis file preserves collected upstream notices. See dependency-inventory.json for versions, hashes, sources, scope and unresolved release gates. Collection alone is not a licensing-completeness assertion.\n\nThis software is based in part on the work of the Independent JPEG Group.\n';
 for(const component of components){text+='\n'+'='.repeat(72)+'\n'+component.id+'\nDeclared license: '+(component.license??'NOT DECLARED')+'\nSource: '+(component.source??'CadCove original source')+'\n';for(const notice of component.notices)text+='\n--- '+notice.name+' ---\n'+notice.text+'\n';}
 return {inventory,text};
}
export async function writeDependencyNotices(root,output,options){const {inventory,text}=await dependencyNotices(root,options);await mkdir(output,{recursive:true});await writeFile(path.join(output,'THIRD-PARTY-NOTICES.txt'),text);await writeFile(path.join(output,'dependency-inventory.json'),JSON.stringify(inventory,null,2)+'\n');return inventory;}
