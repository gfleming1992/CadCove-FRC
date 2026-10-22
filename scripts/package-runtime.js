// Package a host-built native binary with a standalone CLI. Release CI must
// build/test the native input on each target before publishing these files.
import path from 'node:path';
import {packageTeamExample} from '../lib/team-example.js';
import {mkdtemp, mkdir, cp, rm, rename, chmod, writeFile, readFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateRuntimeManifest} from '../lib/runtime-install.js';
import {bridgeSources} from '../lib/bridge-export.js';
import {cadReferenceBundle,validateCadReference} from '../lib/cad-reference.js';
import {writeDependencyNotices} from '../lib/dependency-notices.js';
import {readNativeBuild,parseRustCompiler} from '../lib/native-build-provenance.js';
import {bunRelease,cliCompilerRecord,cliBuildRecord,externalCliBuildRecord} from '../lib/cli-build-provenance.js';

const options = {};
const args = process.argv.slice(2);
while (args.length) {
  const key = args.shift(), value = args.shift();
  if (!['--native-binary','--output','--base-url','--version','--team-example','--cli-mode'].includes(key) || !value || value.startsWith('--') || key in options) throw Error('Usage: bun scripts/package-runtime.js --native-binary FILE --output NEW_DIRECTORY --base-url HTTPS_URL [--version 0.1.0-dev] [--team-example EXPORTED_WORKSPACE] [--cli-mode external-bun|standalone]');
  options[key] = value;
}
for (const key of ['--native-binary','--output','--base-url']) if (!options[key]) throw Error('Missing ' + key);
const root = path.resolve(import.meta.dir, '..'), output = path.resolve(options['--output']);
const cliMode=options['--cli-mode']??'external-bun';
if(!['external-bun','standalone'].includes(cliMode))throw Error('Invalid CLI mode');
const external=cliMode==='external-bun';
const base = new URL(options['--base-url'].replace(/\/?$/, '/'));
if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw Error('Release base URL must be HTTPS without credentials, query or fragment');
const version = options['--version'] || '0.1.0-dev';
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw Error('Invalid runtime version');
try { await lstat(output); throw Error('Output already exists; choose a new release directory'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(path.dirname(output), {recursive: true});
const staging = await mkdtemp(path.join(path.dirname(output), '.runtime-package-'));
try {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const names = ['cadcove' + suffix, 'instantcad-sim' + suffix];
  const compilerBytes=await readFile(process.execPath),lock=await readFile(path.join(root,'bun.lock'));
  const compiler=cliCompilerRecord(compilerBytes,{version:Bun.version,revision:Bun.revision,target:process.platform+'-'+process.arch});
  const cliOutput=path.join(staging,external?'cadcove.js':names[0]);
  const build = Bun.spawn([process.execPath, 'build', ...(external?['--target=bun']:['--compile']), '--minify', '--define', 'CADCOVE_BUNDLED=true', '--define','CADCOVE_EXTERNAL_BUN='+external, '--define', 'CADCOVE_VERSION=' + JSON.stringify(version), path.join(root, 'bin/cadcove.js'), '--outfile', cliOutput], {cwd: root, stdout: 'inherit', stderr: 'inherit'});
  if (await build.exited) throw Error('Standalone CLI compilation failed');
  if(!compilerBytes.equals(await readFile(process.execPath))||!lock.equals(await readFile(path.join(root,'bun.lock'))))throw Error('CLI compiler or lock changed during compilation');
  let launcherCompiler,launcherSource;
  if(external){
    // Check the exact qualified interpreter before loading any workspace code.
    const script=(await readFile(cliOutput,'utf8')).replace(/^#![^\n]*\n/,'');
    await writeFile(cliOutput,`if(Bun.version!==${JSON.stringify(bunRelease.version)}||Bun.revision!==${JSON.stringify(bunRelease.revision)}){console.error('CadCove requires Bun ${bunRelease.version}; install the pinned version or set CADCOVE_BUN.');process.exit(2);}\n`+script);
    const rustc=Bun.which('rustc');if(!rustc)throw Error('Rust is required to build the CLI launcher');
    const probe=Bun.spawn([rustc,'-Vv'],{stdout:'pipe',stderr:'inherit'});
    const compilerText=await new Response(probe.stdout).text();if(await probe.exited)throw Error('Cannot inspect launcher compiler');
    launcherCompiler=parseRustCompiler(compilerText);
    launcherSource=await readFile(path.join(root,'bin/launcher.rs'));
    await writeFile(path.join(staging,'launcher.rs'),launcherSource);
    // Honor the same explicit linker used by Cargo for workspace-local SDKs.
    const linker=process.env['CARGO_TARGET_'+launcherCompiler.host.toUpperCase().replaceAll('-','_')+'_LINKER'];
    const launchBuild=Bun.spawn([rustc,'--edition=2021','--crate-name','cadcove_launcher','-C','opt-level=s','-C','strip=symbols',...(linker?['-C','linker='+linker]:[]),'--remap-path-prefix',root+'=/cadcove',path.join(root,'bin/launcher.rs'),'-o',path.join(staging,names[0])],{cwd:root,stdout:'inherit',stderr:'inherit'});
    if(await launchBuild.exited)throw Error('CLI launcher compilation failed');
  }
  const cliBytes=await readFile(path.join(staging,names[0]));
  const buildOptions={compiler,target:process.platform+'-'+process.arch,version,launcherCompiler};
  const cliBuild=external?externalCliBuildRecord(cliBytes,await readFile(cliOutput),launcherSource,lock,buildOptions):cliBuildRecord(cliBytes,lock,buildOptions);
  await writeFile(path.join(staging,'cli-build.json'),JSON.stringify(cliBuild,null,2)+'\n');
  await cp(path.resolve(options['--native-binary']), path.join(staging, names[1]));
  // Validate the staged bytes, not a source file that could change after copying.
  await cp(path.resolve(options['--native-binary'])+'.build.json',path.join(staging,names[1]+'.build.json'));
  const nativeBuild=await readNativeBuild(path.join(staging,names[1]),path.join(root,'Cargo.lock'));
  await rm(path.join(staging,names[1]+'.build.json'));
  await writeFile(path.join(staging,'native-build.json'),JSON.stringify(nativeBuild,null,2)+'\n');
  for (const name of names) await chmod(path.join(staging, name), 0o755);
  const probe = Bun.spawn([path.join(staging, names[1])], {stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'});
  probe.stdin.write('{"op":"capabilities"}\n'); probe.stdin.end();
  const timeout = setTimeout(() => probe.kill(), 5000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
    const info = JSON.parse(stdout);
    const required=['gameplay-mechanisms-v1','practice-field-conveyors-v1','practice-cargo-contacts-v1'];
    if (code || !info.ok || required.some(feature=>!info.features?.includes(feature))) throw Error('Native runtime lacks current practice collision/conveyor capabilities: ' + stderr);
  } finally { clearTimeout(timeout); }
  await writeFile(path.join(staging,'bridge-sources.json'),JSON.stringify(await bridgeSources()));
  const reference=await cadReferenceBundle();validateCadReference(reference);
  await writeFile(path.join(staging,'cad-reference.json'),JSON.stringify(reference));
  const example=Bun.spawn([process.execPath,path.join(root,'scripts/package-training-example.js'),'--output',path.join(staging,'training-example.json')],{cwd:root,stdout:'inherit',stderr:'inherit'});
  if(await example.exited)throw Error('Training example packaging failed');
  const inventory=await writeDependencyNotices(root,staging,{includeBunRuntime:!external});
  if(!version.includes('-')&&!inventory.releaseReady)throw Error('Production runtime packaging requires resolved dependency/license gates; inspect dependency-notices output first');
  await cp(path.join(root,'vendor/cad-core/src/native/worker.py'),path.join(staging,'cad-worker.py'));
  await cp(path.join(root,'vendor/cad-core/src/native/requirements.txt'),path.join(staging,'cad-requirements.txt'));
  await cp(path.join(root,'vendor/cad-core/src/native/geometry.py'),path.join(staging,'geometry.py'));
  await cp(path.join(root,'vendor/cad-core/src/native/discovery.py'),path.join(staging,'discovery.py'));
  for(const name of ['step_kinematics.py','sketch_solver.py','cad_references.py','fea_request.py','fea_geometry.py','fea_freecad.py','drawing_geometry.py','drawing_freecad.py','flat_export.py','dxf_preview.py','sheetmetal_geometry.py','sheetmetal_freecad.py','fold_diagram.py','sheetmetal_fold.py'])await cp(path.join(root,'vendor/cad-core/src/native',name),path.join(staging,name));
  for(const [source,name] of [['solver.py','mate-solver.py'],['upstream.json','ondsel-upstream.json'],['LICENSE.Ondsel','ONDSEL-LICENSE.txt']])await cp(path.join(root,'vendor/cad-core/src/native/ondsel',source),path.join(staging,name));
  const extra=['step_kinematics.py','sketch_solver.py','cad_references.py','fea_request.py','fea_geometry.py','fea_freecad.py','drawing_geometry.py','drawing_freecad.py','flat_export.py','dxf_preview.py','sheetmetal_geometry.py','sheetmetal_freecad.py','fold_diagram.py','sheetmetal_fold.py','mate-solver.py','ondsel-upstream.json','ONDSEL-LICENSE.txt','cad-worker.py','discovery.py','geometry.py','cad-requirements.txt',...(external?['cadcove.js','launcher.rs']:[])];
  if(options['--team-example']){await packageTeamExample(path.resolve(options['--team-example']),path.join(staging,'team-example.cpack'));extra.push('team-example.cpack');}
  const files = [];
  for (const name of [...names,...extra,'bridge-sources.json','cad-reference.json','training-example.json','native-build.json','cli-build.json','THIRD-PARTY-NOTICES.txt','dependency-inventory.json']) {
    const bytes = Buffer.from(await Bun.file(path.join(staging, name)).arrayBuffer());
    files.push({name, executable: names.includes(name), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: new URL(name, base).href});
  }
  const manifest = validateRuntimeManifest({schema: 1, version, target: `${process.platform}-${process.arch}`, files});
  await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await rename(staging, output);
  console.log(JSON.stringify({schema: 1, output, manifest, published: false}, null, 2));
} finally { await rm(staging, {recursive: true, force: true}); }
