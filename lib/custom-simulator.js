import path from 'node:path';
import {mkdir, access, writeFile, readFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {nativeExecutable, validateCustomSimulator} from './runtime-location.js';

// Explicit builds execute trusted team Rust/build scripts. Never run on activation.
export async function buildCustomSimulator(project, {signal, onOutput = text => process.stderr.write(text)} = {}) {
  const config = validateCustomSimulator(project.profile.runtime.customSimulator);
  const cwd = path.resolve(project.root, config.sourceDirectory);
  // Presence alone is enough to refuse; stale sessions use the normal recovery flow.
  let active=false;try{await access(path.join(project.build,'.cadcove-session-lock'));active=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(active)throw Error('Stop simulation (or recover its stale session) before building a custom simulator');
  await access(path.join(cwd, 'Cargo.toml'));
  await access(path.join(cwd, 'Cargo.lock')); // Do not silently resolve new dependencies.
  const target = path.join(project.build, 'custom-simulator');
  await mkdir(target, {recursive:true});
  const lock = path.join(target, '.build-lock');
  try { await mkdir(lock); } catch (error) {
    if (error.code === 'EEXIST') throw Error('Custom simulator build already running; inspect '+lock+' if a previous build was interrupted');
    throw error;
  }
  try {
    if (signal?.aborted) throw Error('Custom simulator build cancelled');
    const executable = nativeExecutable(project);
    // A failed build must not silently run an older custom binary.
    await rm(executable, {force:true});
    await rm(executable+'.build.json', {force:true});
    const args = ['build','--locked','--release','--package',config.package,'--bin',config.binary,'--target-dir',target];
    if (config.features?.length) args.push('--features',config.features.join(','));
    await new Promise((resolve,reject) => {
      const child = spawn('cargo',args,{cwd,signal,stdio:['ignore','pipe','pipe'],windowsHide:true});
      child.stdout.on('data',b=>onOutput(b.toString())); child.stderr.on('data',b=>onOutput(b.toString()));
      let failure;
      child.on('error',e=>{failure=Error(e.code==='ENOENT'?'Rust/Cargo is missing. Install Rust and platform build tools, then restart VS Code.':e.message);});
      child.on('close',code=>failure?reject(failure):code===0?resolve():reject(Error('Custom simulator build failed ('+code+')')));
    });
    const bytes = await readFile(executable);
    const report = {schema:1,ok:true,command:'sim-build',executable,sourceDirectory:cwd,package:config.package,
      sha256:createHash('sha256').update(bytes).digest('hex'),builtAt:new Date().toISOString()};
    await writeFile(executable+'.build.json',JSON.stringify(report,null,2)+'\n');
    return report;
  } finally { await rm(lock,{recursive:true,force:true}); }
}
