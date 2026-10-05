import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir, rm, readFile, writeFile, copyFile, cp, realpath} from 'node:fs/promises';
import * as esbuild from 'esbuild';
import {validateRuntimeManifest} from '../lib/runtime-install.js';
import {validateCliBuild} from '../lib/cli-build-provenance.js';
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift(),value=args.shift();if(!['--runtime','--occt-dist'].includes(key)||!value||value.startsWith('--')||key in options)throw Error('Usage: bun scripts/build-toolbox-extension.js --runtime PACKAGED_RUNTIME_DIRECTORY [--occt-dist REBUILT_GLUE_AND_WASM_DIRECTORY]');options[key]=value;}
const runtimeDirectory=options['--runtime'];if(!runtimeDirectory)throw Error('Packaged runtime is required');
const root=path.resolve(import.meta.dir,'..'),core=path.join(root,'vendor/cad-core');
const target=`${process.platform}-${process.arch}`,out=path.join(root,'build','toolbox-extension-'+target),media=path.join(out,'media');
const require=createRequire(import.meta.url);
const occtEntry=await realpath(path.join(root,'node_modules/occt-wasm/dist/index.js')),defaultDist=path.dirname(occtEntry);
const occtDist=options['--occt-dist']?path.resolve(options['--occt-dist']):defaultDist;
const wasm=await readFile(path.join(occtDist,'occt-wasm.wasm')),glue=await readFile(path.join(occtDist,'occt-wasm.js'));
if(!wasm.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0]))||!glue.length)throw Error('OCCT replacement requires a WASM module and its matching generated JavaScript');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const occt={replacement:!!options['--occt-dist'],wasmSha256:hash(wasm),glueSha256:hash(glue),wrapperEntrySha256:hash(await readFile(occtEntry))};
// Keep the pinned JS API adapter; redirect only its Emscripten loader. WASM and
// generated glue are replaced together, avoiding incompatible export tables.
let glueResolved=false;
const occtPlugin={name:'occt-replacement',setup(build){build.onResolve({filter:/^\.\/occt-wasm\.js$/},args=>{if(args.importer!==occtEntry)return;glueResolved=true;return {path:path.join(occtDist,'occt-wasm.js')};});}};
const pin=JSON.parse(await readFile(path.join(core,'upstream.json'),'utf8'));
const runtimeIdentity='brepjs@19.0.5/occt-wasm@5.3.2/mesh-v1/kernel:'+hash(JSON.stringify([pin.revision,occt.wasmSha256,occt.glueSha256,occt.wrapperEntrySha256]));
for(const [file,expected] of Object.entries(pin.files)){
 const bytes=await readFile(path.join(core,file));
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Pinned CAD core was modified: '+file);
}
const runtime=path.resolve(runtimeDirectory),manifest=validateRuntimeManifest(JSON.parse(await readFile(path.join(runtime,'manifest.json'),'utf8')));
for(const file of manifest.files){const bytes=await readFile(path.join(runtime,file.name));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Runtime artifact mismatch: '+file.name);}
if(!manifest.files.some(f=>f.name==='cli-build.json'&&!f.executable))throw Error('Runtime lacks a hashed CLI build record; repackage it');
const cliName='cadcove'+(process.platform==='win32'?'.exe':'');
const cliBuild=validateCliBuild(JSON.parse(await readFile(path.join(runtime,'cli-build.json'),'utf8')),await readFile(path.join(runtime,cliName)),await readFile(path.join(root,'bun.lock')),{target,version:manifest.version});
await rm(out,{recursive:true,force:true});await mkdir(media,{recursive:true});
for(const name of ['package.json','README.md'])await copyFile(path.join(root,'extensions/vscode',name),path.join(out,name));
await copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE.txt'));
await writeFile(path.join(out,'.vscodeignore'),'*.vsix\n');
for(const [entry,name] of [['src/vscode-main.js','main.js'],['src/core/kernel-worker.js','worker.js']]){
 const result=await Bun.build({entrypoints:[path.join(core,entry)],target:'browser',format:'iife',define:{INSTANTCAD_RUNTIME_ID:JSON.stringify(runtimeIdentity),...(name==='worker.js'?{'import.meta.url':'self.__instantcadModuleURL'}:{})},splitting:false,minify:true,outdir:media,naming:name,external:['node:module','node:fs','node:path','node:url'],plugins:name==='worker.js'?[occtPlugin]:[]});
 if(!result.success)throw Error(result.logs.join('\n'));
}
if(!glueResolved||hash(await readFile(path.join(occtDist,'occt-wasm.js')))!==occt.glueSha256)throw Error('Selected OCCT loader was not bundled or changed during build');
await writeFile(path.join(media,'occt.wasm'),wasm);
await copyFile(path.join(core,'index.html'),path.join(media,'index.html'));
const simulation=await Bun.build({entrypoints:[path.join(root,'web/editor-simulation.js')],target:'browser',format:'iife',minify:true,outdir:media,naming:'simulation.js'});
if(!simulation.success)throw Error(simulation.logs.join('\n'));
const robot=await Bun.build({entrypoints:[path.join(root,'web/editor-robot.js')],target:'browser',format:'iife',minify:true,outdir:media,naming:'robot.js'});
if(!robot.success)throw Error(robot.logs.join('\n'));
await writeFile(path.join(media,'manifest.json'),JSON.stringify({main:'main.js',worker:'worker.js',wasm:'occt.wasm'}));
await esbuild.build({entryPoints:[path.join(root,'extensions/vscode/src/extension.js')],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:path.join(out,'out/extension.cjs'),external:['vscode','esbuild'],define:{INSTANTCAD_RUNTIME_ID:JSON.stringify(runtimeIdentity)}});
const compilerRoot=path.dirname(require.resolve('esbuild/package.json'));
await mkdir(path.join(out,'node_modules'),{recursive:true});await cp(compilerRoot,path.join(out,'node_modules/esbuild'),{recursive:true});
const platformPackage=`@esbuild/${target}`,binaryRoot=path.dirname(require.resolve(platformPackage+'/package.json'));
await mkdir(path.join(out,'node_modules/@esbuild'),{recursive:true});await cp(binaryRoot,path.join(out,'node_modules',platformPackage),{recursive:true});
await mkdir(path.join(out,'runtime'),{recursive:true});
for(const file of [...manifest.files.map(f=>f.name),'manifest.json'])await copyFile(path.join(runtime,file),path.join(out,'runtime',file));
if(manifest.files.some(file=>file.name==='THIRD-PARTY-NOTICES.txt'))await copyFile(path.join(runtime,'THIRD-PARTY-NOTICES.txt'),path.join(out,'THIRD-PARTY-NOTICES.txt'));
const inventory=JSON.parse(await readFile(path.join(runtime,'dependency-inventory.json'),'utf8'));
const kernel=inventory.components.find(c=>c.id==='wasm:occt-wasm@5.3.2');if(!kernel)throw Error('OCCT inventory entry missing');
kernel.artifactSha256=occt.wasmSha256;
kernel.generatedGlueSha256=occt.glueSha256;
if(occt.replacement){kernel.modified=true;inventory.releaseReady=false;inventory.unresolved.push({id:kernel.id,reason:'Locally rebuilt kernel: source correspondence, modifications and runtime replacement qualification require review'});}
await writeFile(path.join(out,'dependency-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
await copyFile(path.join(root,'licenses/occt-source.json'),path.join(out,'occt-source.json'));
await writeFile(path.join(out,'build-provenance.json'),JSON.stringify({schema:1,target,cadCore:pin.revision,runtime:manifest.version,runtimeIdentity,cliBuild,occt,published:false},null,2)+'\n');
console.log(JSON.stringify({extension:out,target,cadCore:pin.revision,bundledRuntime:manifest.version}));
