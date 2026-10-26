// Release-engineering entry point. Verify the installed native CAD assets.
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,readFile,rename,rm} from 'node:fs/promises';
import {createVSIX} from '@vscode/vsce';
import {readZip} from '@vscode/vsce/out/zip.js';
import {validateRuntimeManifest} from '../lib/runtime-install.js';
import {validateCliBuild} from '../lib/cli-build-provenance.js';
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift();if(!['--extension','--output','--development'].includes(key)||key in options)throw Error('Usage: bun scripts/package-toolbox-extension.js --extension DIRECTORY --output NEW_VSIX [--development]');const value=key==='--development'?true:args.shift();if(!value||typeof value==='string'&&value.startsWith('--'))throw Error('Missing value for '+key);options[key]=value;}
if(!options['--extension']||!options['--output'])throw Error('extension and output are required');
const cwd=path.resolve(options['--extension']),output=path.resolve(options['--output']),development=!!options['--development'];
if(!output.endsWith('.vsix'))throw Error('Output must end in .vsix');
try{await lstat(output);throw Error('Output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const manifest=validateRuntimeManifest(JSON.parse(await readFile(path.join(cwd,'runtime/manifest.json'),'utf8')));
const inventory=JSON.parse(await readFile(path.join(cwd,'dependency-inventory.json'),'utf8'));
const extension=JSON.parse(await readFile(path.join(cwd,'package.json'),'utf8'));
if(!development&&(!inventory.releaseReady||!extension.license||extension.license==='UNLICENSED'||!extension.repository||!extension.publisher||extension.publisher==='cadcove-dev'))throw Error('Production VSIX requires resolved licensing and publication identity; use --development only for a local candidate');
const required=['package.json','build-provenance.json','dependency-inventory.json','out/extension.cjs','media/main.js','media/native/worker.py','media/native/geometry.py','media/native/requirements.txt','runtime/manifest.json','THIRD-PARTY-NOTICES.txt'];
const expected=new Map();
required.push('LICENSE.txt');
for(const name of [...required,...manifest.files.map(f=>'runtime/'+f.name)]){const bytes=await readFile(path.join(cwd,name));expected.set('extension/'+name.toLowerCase(),createHash('sha256').update(bytes).digest('hex'));}
for(const file of manifest.files)if(expected.get('extension/runtime/'+file.name.toLowerCase())!==file.sha256)throw Error('Staged runtime checksum mismatch: '+file.name);
const provenance=JSON.parse(await readFile(path.join(cwd,'build-provenance.json'),'utf8'));
if(!manifest.files.some(f=>f.name==='cli-build.json'&&!f.executable))throw Error('Runtime lacks a hashed CLI build record');
const cliName='cadcove'+(manifest.target.startsWith('win32-')?'.exe':'');
const cliRecord=JSON.parse(await readFile(path.join(cwd,'runtime/cli-build.json'),'utf8'));
const cliBuild=validateCliBuild(cliRecord,await readFile(path.join(cwd,'runtime',cliName)),await readFile(path.resolve(import.meta.dir,'../bun.lock')),{target:manifest.target,version:manifest.version,...(cliRecord.schema===2?{script:await readFile(path.join(cwd,'runtime/cadcove.js')),launcherSource:await readFile(path.join(cwd,'runtime/launcher.rs'))}:{})});
if(inventory.profile==='external-bun'&&cliRecord.schema!==2)throw Error('External Bun notices cannot qualify an embedded Bun executable');
if(JSON.stringify(provenance.cliBuild)!==JSON.stringify(cliBuild))throw Error('Extension CLI provenance differs from its packaged runtime');
if(provenance.cadBackend!=='native-cadquery')throw Error('Expected native-only CAD package');

await mkdir(path.dirname(output),{recursive:true});const temporary=path.join(path.dirname(output),'.vsix-'+randomUUID()+'.vsix');
try{
 await createVSIX({cwd,packagePath:temporary,target:manifest.target,dependencies:true,useYarn:false,allowMissingRepository:development,skipLicense:development});
 // readZip is pinned with vsce 4.0.0. This inspects our just-created archive,
 // not arbitrary user-supplied ZIPs; then compare critical bytes with staging.
 const forbidden=await readZip(temporary,name=>/\.wasm$|(?:^|\/)kernel-worker\.js$|(?:^|\/)(?:brepjs|occt-wasm)(?:\/|$)/i.test(name));
 if(forbidden.size)throw Error('Legacy CAD kernel leaked into VSIX: '+[...forbidden.keys()].join(', '));
 const caches=await readZip(temporary,name=>/(?:^|\/)__pycache__\/|\.py[co]$/i.test(name));
 if(caches.size)throw Error('Python build caches leaked into VSIX: '+[...caches.keys()].join(', '));
 const entries=await readZip(temporary,name=>expected.has(name));
 for(const [name,hash] of expected){const bytes=entries.get(name);if(!bytes||createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('VSIX missing or changed required file: '+name);}
 await rename(temporary,output);
 console.log(JSON.stringify({ok:true,output,target:manifest.target,runtime:manifest.version,development,verifiedFiles:expected.size,published:false}));
}finally{await rm(temporary,{force:true});}
