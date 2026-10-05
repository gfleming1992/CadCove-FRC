import path from 'node:path';
import os from 'node:os';
import {readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {parseRustCompiler,nativeBuildRecord} from '../lib/native-build-provenance.js';
const root=path.resolve(import.meta.dir,'..');
const env={...process.env,CARGO_PROFILE_RELEASE_LTO:'thin',CARGO_PROFILE_RELEASE_CODEGEN_UNITS:'1'};
delete env.RUSTFLAGS;delete env.CARGO_ENCODED_RUSTFLAGS;
for(const name of Object.keys(env))if(/^CARGO_TARGET_.*_RUSTFLAGS$/.test(name))delete env[name];
// Release binaries target the platform baseline, not the build machine's CPU.
// Also keep personal checkout/registry paths out of embedded panic locations.
env.CARGO_ENCODED_RUSTFLAGS=[`--remap-path-prefix=${os.homedir()}=/build-home`,`--remap-path-prefix=${root}=/cadcove`].join('\x1f');
// Use the compiler we inspect; neutralize inherited compiler wrappers. Build
// explicitly for its host so Cargo configuration cannot select another target.
env.RUSTC=Bun.which('rustc');
if(!env.RUSTC)throw Error('Rust is required to build release artifacts');
env.RUSTC_WRAPPER='';env.RUSTC_WORKSPACE_WRAPPER='';
const probe=Bun.spawn([env.RUSTC,'-Vv'],{cwd:root,env,stdout:'pipe',stderr:'inherit'});
const compilerText=await new Response(probe.stdout).text();
if(await probe.exited)throw Error('Cannot inspect release compiler');
const compiler=parseRustCompiler(compilerText);
const binaryName='instantcad-sim'+(process.platform==='win32'?'.exe':'');
const binaryPath=path.join(root,'target/distribution/release',binaryName);
await rm(binaryPath+'.build.json',{force:true});
const lock=await readFile(path.join(root,'Cargo.lock'));
const child=Bun.spawn(['cargo','build','--locked','--release','-p','instantcad-sim','--features','composite-compact','--target',compiler.host,'--target-dir',path.join(root,'target/distribution')],{cwd:root,env,stdout:'inherit',stderr:'inherit'});
if(await child.exited)throw Error('Native release build failed');
if(!lock.equals(await readFile(path.join(root,'Cargo.lock'))))throw Error('Dependency lock changed during build');
await mkdir(path.dirname(binaryPath),{recursive:true});
await cp(path.join(root,'target/distribution',compiler.host,'release',binaryName),binaryPath);
await writeFile(binaryPath+'.build.json',JSON.stringify(nativeBuildRecord(await readFile(binaryPath),lock,compiler),null,2)+'\n');
