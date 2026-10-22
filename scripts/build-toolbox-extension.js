import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir, rm, readFile, writeFile, copyFile, cp, realpath} from 'node:fs/promises';
import * as esbuild from 'esbuild';
import {validateRuntimeManifest} from '../lib/runtime-install.js';
import {validateCliBuild} from '../lib/cli-build-provenance.js';
import {nativeIdentityFor} from '../vendor/cad-core/src/native/client.js';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--runtime')throw Error('Usage: bun scripts/build-toolbox-extension.js --runtime PACKAGED_RUNTIME_DIRECTORY');
const root=path.resolve(import.meta.dir,'..'),core=path.join(root,'vendor/cad-core');
const target=`${process.platform}-${process.arch}`,out=path.join(root,'build','toolbox-extension-'+target),media=path.join(out,'media');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeDirectory=args[1];
const runtimeIdentity=nativeIdentityFor(path.join(core,'src/native/worker.py'));
const pin=JSON.parse(await readFile(path.join(core,'upstream.json'),'utf8'));
for(const [file,expected] of Object.entries(pin.files)){
 const bytes=await readFile(path.join(core,file));
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Pinned CAD core was modified: '+file);
}
const runtime=path.resolve(runtimeDirectory),manifest=validateRuntimeManifest(JSON.parse(await readFile(path.join(runtime,'manifest.json'),'utf8')));
for(const file of manifest.files){const bytes=await readFile(path.join(runtime,file.name));if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Runtime artifact mismatch: '+file.name);}
if(!manifest.files.some(f=>f.name==='cli-build.json'&&!f.executable))throw Error('Runtime lacks a hashed CLI build record; repackage it');
const cliName='cadcove'+(process.platform==='win32'?'.exe':'');
const cliRecord=JSON.parse(await readFile(path.join(runtime,'cli-build.json'),'utf8'));
const cliBuild=validateCliBuild(cliRecord,await readFile(path.join(runtime,cliName)),await readFile(path.join(root,'bun.lock')),{target,version:manifest.version,...(cliRecord.schema===2?{script:await readFile(path.join(runtime,'cadcove.js')),launcherSource:await readFile(path.join(runtime,'launcher.rs'))}:{})});
await rm(out,{recursive:true,force:true});await mkdir(media,{recursive:true});
for(const name of ['package.json','README.md'])await copyFile(path.join(root,'extensions/vscode',name),path.join(out,name));
if(process.env.CADCOVE_EXTENSION_VERSION){
 const version=process.env.CADCOVE_EXTENSION_VERSION;if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid CADCOVE_EXTENSION_VERSION');
 const file=path.join(out,'package.json'),extension=JSON.parse(await readFile(file,'utf8'));extension.version=version;await writeFile(file,JSON.stringify(extension,null,2)+'\n');
}
await copyFile(path.join(root,'LICENSE'),path.join(out,'LICENSE.txt'));
await writeFile(path.join(out,'.vscodeignore'),'*.vsix\n');
const viewer=await Bun.build({entrypoints:[path.join(core,'src/vscode-main.js')],target:'browser',format:'iife',minify:true,outdir:media,naming:'main.js'});
if(!viewer.success)throw Error(viewer.logs.join('\n'));
await cp(path.join(core,'src/native'),path.join(media,'native'),{recursive:true});
await copyFile(path.join(core,'index.html'),path.join(media,'index.html'));
const simulation=await Bun.build({entrypoints:[path.join(root,'web/editor-simulation.js')],target:'browser',format:'iife',minify:true,outdir:media,naming:'simulation.js'});
if(!simulation.success)throw Error(simulation.logs.join('\n'));
const mechanism=await Bun.build({entrypoints:[path.join(root,'web/editor-mechanism.js')],target:'browser',format:'iife',minify:true,outdir:media,naming:'mechanism.js'});
if(!mechanism.success)throw Error(mechanism.logs.join('\n'));
const robot=await Bun.build({entrypoints:[path.join(root,'web/editor-robot.js')],target:'browser',format:'iife',minify:true,outdir:media,naming:'robot.js'});
if(!robot.success)throw Error(robot.logs.join('\n'));
await writeFile(path.join(media,'manifest.json'),JSON.stringify({main:'main.js'}));
await esbuild.build({entryPoints:[path.join(root,'extensions/vscode/src/extension.js')],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:path.join(out,'out/extension.cjs'),external:['vscode'],define:{INSTANTCAD_RUNTIME_ID:JSON.stringify(runtimeIdentity)}});
await mkdir(path.join(out,'runtime'),{recursive:true});
for(const file of [...manifest.files.map(f=>f.name),'manifest.json'])await copyFile(path.join(runtime,file),path.join(out,'runtime',file));
if(manifest.files.some(file=>file.name==='THIRD-PARTY-NOTICES.txt'))await copyFile(path.join(runtime,'THIRD-PARTY-NOTICES.txt'),path.join(out,'THIRD-PARTY-NOTICES.txt'));
const inventory=JSON.parse(await readFile(path.join(runtime,'dependency-inventory.json'),'utf8'));
await writeFile(path.join(out,'dependency-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
await writeFile(path.join(out,'build-provenance.json'),JSON.stringify({schema:1,target,cadCore:pin.revision,runtime:manifest.version,runtimeIdentity,cliBuild,cadBackend:"native-cadquery",published:false},null,2)+'\n');
console.log(JSON.stringify({extension:out,target,cadCore:pin.revision,bundledRuntime:manifest.version}));
