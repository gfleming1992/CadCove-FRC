// Integration smoke test against real packaged executables. Downloads are
// served from the supplied artifact directory through the installer's fetch
// seam; no network or user's robot process is required.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, realpath, readFile, writeFile, access} from 'node:fs/promises';
import {installRuntime} from '../lib/runtime-install.js';

assert.ok(process.argv[2], 'Pass a packaged runtime directory');
const source = path.resolve(process.argv[2]);
const manifest = await Bun.file(path.join(source, 'manifest.json')).json();
const root = await mkdtemp(path.join(os.tmpdir(), 'cadcove-packaged-smoke-'));
try {
  const installed = await installRuntime({manifest, cacheDirectory: path.join(root, 'cache'), fetchImpl: async url => {
    const file = manifest.files.find(f => f.url === url);
    assert.ok(file, 'Unexpected requested artifact');
    return new Response(Bun.file(path.join(source, file.name)));
  }});
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const executable = path.join(installed.directory, 'cadcove' + suffix);
  const workspace = path.join(root, 'unrelated-team'); await mkdir(workspace);
  // Deliberately do not inherit PATH, Bun, Cargo, native/JDK overrides, or the
  // source repository cwd. The executable must locate its adjacent runtime.
  const env = {HOME: root, USERPROFILE: root, TMPDIR: os.tmpdir(), ...(process.platform === 'win32' ? {SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir()} : {})};
  async function command(args, code = 0) {
    const p = Bun.spawn([executable, ...args], {cwd: workspace, env, stdout: 'pipe', stderr: 'pipe'});
    const [out, err, actual] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    assert.equal(actual, code, out + '\n' + err); assert.equal(err, '');
    return JSON.parse(out);
  }
  const capabilities = await command(['capabilities']);
  assert.equal(capabilities.distribution, 'standalone-runtime'); assert.equal(capabilities.version, manifest.version);
  const inventory=JSON.parse(await readFile(path.join(installed.directory,'dependency-inventory.json'),'utf8'));
  assert.equal(inventory.schema,1);assert.equal(typeof inventory.releaseReady,'boolean');
  assert.ok(inventory.components.some(c=>c.id==='wasm:occt-wasm@5.3.2'&&c.license.includes('LGPL')));
  assert.ok(inventory.components.some(c=>c.id==='npm:occt-wasm@5.3.2'&&c.license==='MIT OR Apache-2.0'));
  const nativeBuild=JSON.parse(await readFile(path.join(installed.directory,'native-build.json'),'utf8'));
  const cliBuild=JSON.parse(await readFile(path.join(installed.directory,'cli-build.json'),'utf8'));
  assert.equal(cliBuild.target,manifest.target);assert.equal(cliBuild.version,manifest.version);
  assert.equal(cliBuild.binary.sha256,manifest.files.find(f=>f.name==='cadcove'+suffix).sha256);
  assert.equal(cliBuild.compiler.revision,'744846f844374847c902b5e7fd59b4342a51ef99');
  assert.doesNotMatch(JSON.stringify(cliBuild),/\/Users\/|\\Users\\/);
  assert.equal(nativeBuild.target,manifest.target);
  assert.equal(nativeBuild.binary.sha256,manifest.files.find(f=>f.name==='instantcad-sim'+suffix).sha256);
  assert.ok(inventory.components.some(c=>c.id==='runtime:rust-std@'+nativeBuild.compiler.version));
  assert.doesNotMatch(JSON.stringify(inventory),/\/Users\/|\\Users\\/);
  assert.match(await readFile(path.join(installed.directory,'THIRD-PARTY-NOTICES.txt'),'utf8'),/GNU LESSER GENERAL PUBLIC LICENSE/);
  await command(['init', '--workspace', workspace, '--id', 'fresh-team', '--cad-dir', 'design/robot', '--build-dir', 'generated/cad']);
  for(const file of ['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'])assert.match(await readFile(path.join(workspace,file),'utf8'),/\.cadcove\/AGENT\.md/);
  for(const skill of ['frc-workflow','frc-cad-mechanisms','frc-ctre-controls','frc-vision','frc-season-rules','frc-simulation-validation'])assert.match(await readFile(path.join(workspace,'.cadcove/skills',skill,'SKILL.md'),'utf8'),/^---\nname: /);
  const reference=JSON.parse(await readFile(path.join(installed.directory,'cad-reference.json'),'utf8'));
  assert.ok(manifest.files.some(f=>f.name==='cad-reference.json'&&!f.executable));
  for(const entry of reference.files)assert.equal(await readFile(path.join(workspace,entry.file),'utf8'),entry.text);
  assert.match(await readFile(path.join(workspace,'.cadcove/skills/references/brepjs-api.md'),'utf8'),/export declare function box\(/);
  assert.match(await readFile(path.join(workspace,'.cadcove/skills/references/cad-authoring.md'),'utf8'),/cadcove cad-status/);
  // A damaged packaged reference must fail before initializing any workspace.
  const referenceFile=path.join(installed.directory,'cad-reference.json'),referenceBytes=await readFile(referenceFile);
  try{
    reference.files[0].text+='altered';await writeFile(referenceFile,JSON.stringify(reference));
    const rejected=path.join(root,'rejected-reference');await command(['init','--workspace',rejected],2);await assert.rejects(access(rejected));
  }finally{await writeFile(referenceFile,referenceBytes);}
  assert.equal(JSON.parse(await readFile(path.join(workspace,'.cadcove/seasons/2026.json'),'utf8')).id,'frc-2026-rebuilt');
  assert.equal(JSON.parse(await readFile(path.join(workspace,'.cadcove/frc.json'),'utf8')).seasonKnowledge,null);
  const pdf=path.join(workspace,'fixture.pdf'),pages=path.join(workspace,'fixture-pages.json');
  const pdfBytes=Buffer.from('%PDF-1.4\nSynthetic search fixture, not FIRST content.\n');
  await writeFile(pdf,pdfBytes);await writeFile(pages,JSON.stringify({sourceSha256:createHash('sha256').update(pdfBytes).digest('hex'),pages:['Fixture bumper overview.','R202: Bumper attachment. Check bumper material and bumper support.']}));
  const knowledge=await command(['season-import','--workspace',workspace,'--pack',path.join(workspace,'.cadcove/seasons/2026.json'),'--pdf',pdf,'--pages',pages,'--revision','synthetic-test']);
  const result=await command(['season-search','--directory',knowledge.directory,'--query','bumper','--limit','1']);
  assert.equal(result.totalMatches,2);assert.equal(result.hits[0].page,2);assert.equal(result.nextOffset,1);
  const rest=await command(['season-search','--directory',knowledge.directory,'--query','bumper','--limit','1','--offset',String(result.nextOffset)]);
  assert.equal(rest.hits[0].page,1);assert.equal(rest.nextOffset,null);
  await command(['season-search','--directory',knowledge.directory,'--query','bumper','--limit','21'],2);
  assert.equal((await command(['guidance-update','--workspace',workspace,'--dry-run'])).updated.length,0);
  const customSkill=path.join(workspace,'.cadcove/skills/frc-vision/SKILL.md');
  const originalSkill=await readFile(customSkill,'utf8');await writeFile(customSkill,originalSkill+'\nTeam camera calibration notes.\n');
  const update=await command(['guidance-update','--workspace',workspace],1);
  assert.equal(update.conflicts.length,1);assert.match(await readFile(customSkill,'utf8'),/Team camera calibration notes/);
  assert.equal(await readFile(path.join(workspace,update.conflicts[0].proposal),'utf8'),originalSkill);
  await writeFile(customSkill,originalSkill);assert.equal((await command(['guidance-update','--workspace',workspace])).ok,true);
  const exported=await command(['bridge-export','--workspace',workspace]);
  assert.ok(exported.created>3);
  assert.match(await readFile(path.join(exported.directory,'java/org/instantcad/frc/ManagedSession.java'),'utf8'),/CADCOVE_SESSION_FILE/);
  assert.match(await readFile(path.join(exported.directory,'java/org/instantcad/frc/SeasonPlugin.java'),'utf8'),/interface SeasonPlugin/);
  assert.match(await readFile(path.join(exported.directory,'SEASON-PLUGINS.md'),'utf8'),/ServiceLoader/);
  assert.match(await readFile(path.join(exported.directory,'java/org/instantcad/frc/MotorAdapter.java'),'utf8'),/interface MotorAdapter/);
  assert.match(await readFile(path.join(exported.directory,'DEVICE-ADAPTERS.md'),'utf8'),/turnsPerUnit/);
  await assert.rejects(access(path.join(exported.directory,'java/org/instantcad/frc/ShotTuning.java')));
  assert.equal((await command(['bridge-export','--workspace',workspace])).created,0);
  const customizedBridge=path.join(exported.directory,'java/org/instantcad/frc/ManagedSession.java');
  const upstreamBridge=await readFile(customizedBridge,'utf8');await writeFile(customizedBridge,upstreamBridge+'\n// Team customization\n');
  await command(['bridge-export','--workspace',workspace],2);
  const review=await command(['bridge-export','--workspace',workspace,'--review']);
  assert.equal(review.comparison.find(f=>f.file==='java/org/instantcad/frc/ManagedSession.java').status,'different');
  assert.equal(await readFile(path.join(review.directory,'java/org/instantcad/frc/ManagedSession.java'),'utf8'),upstreamBridge);
  assert.match(await readFile(customizedBridge,'utf8'),/Team customization/);
  assert.equal((await command(['bridge-export','--workspace',workspace,'--review'])).created,0);
  const sample=path.join(root,'training example');
  const example=await command(['example-create','--workspace',sample,'--example','training-robot']);
  assert.equal(example.cadReady,true);assert.equal(example.robotBuildRequired,true);assert.equal(example.phoenixDescriptorIncluded,false);
  assert.equal(JSON.parse(await readFile(path.join(sample,'.cadcove/project.json'))).simulationProject,'robot.sim.json');
  assert.equal(JSON.parse(await readFile(path.join(sample,'.cadcove/frc.json'))).season,'example.training-zone');
  assert.equal((await command(['audit','--project',example.project])).canLoad,true);
  assert.equal((await command(['audit','--project',example.project])).sourceFreshness.status,'verified');
  // Native world validation works without Java/vendor libraries and must not
  // contact or rewrite another live session in the same project directory.
  const build=path.join(sample,'build/cadcove');
  const sessionSentinel=path.join(build,'cadcove-session.json');
  const lockSentinel=path.join(build,'.cadcove-session-lock');
  await writeFile(sessionSentinel,'existing session sentinel');await mkdir(lockSentinel);
  await writeFile(path.join(lockSentinel,'owner.json'),'existing owner sentinel');
  const validation=await command(['sim-validate','--project',example.project]);
  assert.equal(validation.ok,true);assert.equal(validation.phase,'native-load');
  assert.equal(validation.tick,0);assert.equal(validation.time,0);assert.ok(validation.bodies>0);
  assert.equal(await readFile(sessionSentinel,'utf8'),'existing session sentinel');
  assert.equal(await readFile(path.join(lockSentinel,'owner.json'),'utf8'),'existing owner sentinel');
  await rm(sessionSentinel);await rm(lockSentinel,{recursive:true});
  const worldFile=path.join(build,'world.json'),bindingsFile=path.join(build,'scene-bindings.json');
  const originalWorld=await readFile(worldFile),originalBindings=await readFile(bindingsFile);
  const detailed=await command(['sim-mode','--project',example.project,'--mode','accurate','--output',path.join(sample,'build/detailed')]);
  assert.equal((await command(['sim-validate','--project',detailed.project])).ok,true);
  assert.deepEqual(await readFile(path.join(sample,'build/detailed/world.json')),originalWorld);
  const recipeFile=path.join(sample,'practice.json');
  await writeFile(recipeFile,JSON.stringify({sourceWorldHash:createHash('sha256').update(originalWorld).digest('hex'),description:'Independent solver trial',evidence:'Native load test only',settings:{solver_iterations:4}}));
  const practice=await command(['sim-mode','--project',example.project,'--mode','gameplay','--output',path.join(sample,'build/practice'),'--recipe',recipeFile]);
  assert.equal((await command(['sim-validate','--project',practice.project])).ok,true);

  const collider=Buffer.alloc(12+4*12+4*12);
  collider.write('CTM1');collider.writeUInt32LE(4,4);collider.writeUInt32LE(4,8);
  [0,0,0, .1,0,0, 0,.1,0, 0,0,.1].forEach((v,i)=>collider.writeFloatLE(v,12+i*4));
  [0,2,1, 0,1,3, 0,3,2, 1,2,3].forEach((v,i)=>collider.writeUInt32LE(v,60+i*4));
  const colliderHash=createHash('sha256').update(collider).digest('hex');
  await writeFile(path.join(sample,'validation-fixture.ctm'),collider);
  try{
    for(const kind of ['mass','valid-mesh','missing-mesh','wrong-mesh-hash']){
      const world=JSON.parse(originalWorld),bindings=JSON.parse(originalBindings);
      if(kind==='mass')world.bodies.find(b=>b.id==='chassis').mass=0;
      else world.bodies.find(b=>b.id==='chassis').colliders=[{kind:'mesh_file',file:kind==='missing-mesh'?'missing-validation-fixture.ctm':'validation-fixture.ctm',sha256:kind==='wrong-mesh-hash'?'0'.repeat(64):colliderHash,convex:true}];
      const bytes=JSON.stringify(world);bindings.worldHash=createHash('sha256').update(bytes).digest('hex');
      await writeFile(worldFile,bytes);await writeFile(bindingsFile,JSON.stringify(bindings));
      assert.equal((await command(['audit','--project',example.project])).canLoad,true);
      const checked=await command(['sim-validate','--project',example.project],kind==='valid-mesh'?0:1);
      assert.equal(checked.phase,'native-load');
      if(kind==='valid-mesh')assert.equal(checked.ok,true);
      else assert.match(checked.errors.join(' '),kind==='mass'?/invalid mass/:kind==='missing-mesh'?/collider artifact missing/:/collider hash mismatch/);
    }
    await writeFile(worldFile,originalWorld); // bindings now intentionally stale
    const rejected=await command(['sim-validate','--project',example.project],1);
    assert.equal(rejected.phase,'audit');assert.match(rejected.errors.join(' '),/different builds/);
  }finally{await writeFile(worldFile,originalWorld);await writeFile(bindingsFile,originalBindings);await rm(path.join(sample,'validation-fixture.ctm'));}
  for(const file of ['cad/model.js','src/main/java/frc/robot/Robot.java','.cadcove/bridge/java/org/instantcad/frc/SeasonPlugin.java','AGENTS.md','.github/copilot-instructions.md'])assert.ok((await readFile(path.join(sample,file))).length>0);
  await assert.rejects(access(path.join(sample,'build/libs/robot.jar')));
  await assert.rejects(access(path.join(sample,'training-profile.json')));
  const sourceBefore=await readFile(path.join(sample,'cad/model.js'),'utf8');
  await writeFile(path.join(sample,'cad/model.js'),sourceBefore+'\n// changed after compilation\n');
  assert.equal((await command(['audit','--project',example.project],1)).sourceFreshness.status,'stale');
  const rejectedSource=await command(['sim-run','--project',example.project],2);
  assert.match(rejectedSource.error.message,/Source input changed/);
  await assert.rejects(access(path.join(sample,'build/cadcove/cadcove-session.json')));
  await writeFile(path.join(sample,'cad/model.js'),sourceBefore);
  await command(['example-create','--workspace',sample,'--example','training-robot'],2);
  assert.equal(await readFile(path.join(sample,'cad/model.js'),'utf8'),sourceBefore);
  // Corruption must fail before even reserving a workspace, not export a partial
  // source tree that an agent might mistake for the verified example.
  const bundleFile=path.join(installed.directory,'training-example.json'),bundleBytes=await readFile(bundleFile);
  try{
    const bundle=JSON.parse(bundleBytes);bundle.files[0].sha256='0'.repeat(64);await writeFile(bundleFile,JSON.stringify(bundle));
    const rejected=path.join(root,'rejected-example');await command(['example-create','--workspace',rejected,'--example','training-robot'],2);await assert.rejects(access(rejected));
  }finally{await writeFile(bundleFile,bundleBytes);}
  const doctor = await command(['doctor', '--project', path.join(workspace, 'robot.sim.json')], 1);
  const native = doctor.checks.find(c => c.id === 'native-engine');
  assert.equal(native.ok, true); assert.equal(await realpath(native.path), await realpath(path.join(installed.directory, 'instantcad-sim' + suffix)));
  assert.equal(doctor.checks.find(c => c.id === 'compiled-project').ok, false);
  const sim = Bun.spawn([native.path], {cwd: workspace, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe'});
  sim.stdin.write('{"op":"capabilities"}\n'); sim.stdin.end();
  const reply = JSON.parse(await new Response(sim.stdout).text());
  assert.equal(await sim.exited, 0);
  for(const feature of ['gameplay-mechanisms-v1','practice-field-conveyors-v1','practice-cargo-contacts-v1'])assert.ok(reply.features.includes(feature),feature);
  // Execute the actual installed reference, not a separate test-only copy.
  const physicsGuide=await readFile(path.join(workspace,'.cadcove/skills/references/physics-authoring.md'),'utf8');
  assert.match(physicsGuide,/scaled axis-angle/);assert.match(physicsGuide,/sim-validate/);
  const benchWorld=JSON.parse(await readFile(path.join(workspace,'.cadcove/skills/references/physics-world-example.json'),'utf8'));
  const bench=Bun.spawn([native.path],{cwd:workspace,env,stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  bench.stdin.write(JSON.stringify({op:'load',world:benchWorld})+'\n');
  bench.stdin.write(JSON.stringify({op:'step',volts:{'bench-motor':2},steps:20})+'\n');bench.stdin.end();
  const [benchOut,benchErr,benchCode]=await Promise.all([new Response(bench.stdout).text(),new Response(bench.stderr).text(),bench.exited]);
  assert.equal(benchCode,0,benchErr);
  const [initial,moved]=benchOut.trim().split('\n').map(JSON.parse);
  assert.equal(initial.ok,true);assert.equal(initial.state.tick,0);
  assert.equal(moved.ok,true);assert.equal(moved.state.tick,20);
  assert.ok(moved.state.joints['driver-axis'].position>0);
  assert.ok(moved.state.joints['follower-axis'].position<0);
  assert.ok(moved.state.motors['bench-motor'].rotor_turns>0);
  const offline = await installRuntime({manifest, cacheDirectory: path.join(root, 'cache'), fetchImpl: () => {throw Error('Unexpected network');}});
  assert.equal(offline.reused, true);
  console.log(JSON.stringify({ok: true, target: manifest.target, version: manifest.version, standaloneCLI: true, nativeRuntime: true, nativeWorldValidation:true, physicsAuthoringExample:true, workspaceInitialization: true, seasonImportAndSearch:true, exampleExport:true, bridgeExport:true, offlineReuse: true, toolchainRequiredForTheseCommands: false, fullRobotLaunchTested: false}));
} finally { await rm(root, {recursive: true, force: true}); }
