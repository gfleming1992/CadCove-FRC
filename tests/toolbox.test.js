import {test, expect} from 'bun:test';
import {mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializeToolbox} from '../lib/toolbox-project.js';
import {readRobotProject} from '../lib/robot-project.js';
import {cadReferenceBundle,validateCadReference} from '../lib/cad-reference.js';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cadcove-toolbox-'));
  try { await fn(root); } finally { await rm(root, {recursive: true, force: true}); }
}
async function cli(args, cwd) {
  const child = Bun.spawn([process.execPath, path.resolve(import.meta.dir, '../bin/cadcove.js'), ...args], {cwd, stdout: 'pipe', stderr: 'pipe'});
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(stderr).toBe('');
  return {code, result: JSON.parse(stdout), stdout};
}

test('initialization works in another team workspace with nested CAD/build folders and preserves robot sources', () => fixture(async root => {
  await mkdir(path.join(root, 'src')); await writeFile(path.join(root, 'src/Robot.java'), 'existing robot source');
  await writeFile(path.join(root, 'CLAUDE.md'), '# Team Claude instructions\n');
  await writeFile(path.join(root, 'AGENTS.md'), '# Team instructions\nKeep code formatted.\n');
  await mkdir(path.join(root, '.github')); await writeFile(path.join(root, '.github/copilot-instructions.md'), 'Existing Copilot instructions.');
  const result = await initializeToolbox({workspace: root, id: 'team-123', name: 'A different robot', cadDirectory: 'design/robot', buildDirectory: 'generated/cad'});
  expect(result.integrationRequired).toBe(true);
  expect(await readFile(path.join(root,'CLAUDE.md'),'utf8')).toStartWith('# Team Claude instructions\n');
  const profile = await readRobotProject(path.join(root, 'robot.sim.json'));
  expect(profile.profile.id).toBe('team-123'); expect(profile.build).toBe(path.join(root, 'generated/cad'));
  expect(profile.runtime.project).toBe(root); expect(profile.profile.practiceControls).toEqual([]);
  expect(profile.profile.calibration.every(c => c.status === 'unknown')).toBe(true);
  expect(await readFile(path.join(root, 'src/Robot.java'), 'utf8')).toBe('existing robot source');
  expect(await readFile(path.join(root, 'AGENTS.md'), 'utf8')).toStartWith('# Team instructions\nKeep code formatted.\n');
  expect(await readFile(path.join(root, '.github/copilot-instructions.md'), 'utf8')).toStartWith('Existing Copilot instructions.');
  expect(await readdir(path.join(root, 'design/robot'))).toEqual([]);
  const guide=await readFile(path.join(root,'.cadcove/AGENT.md'),'utf8');
  expect(guide).toContain('CAD-only work does not');
  expect(await readFile(path.join(root,'.cadcove/skills/references/brepjs-api.md'),'utf8')).toContain('export declare function box(');
  expect((await initializeToolbox({workspace: root, id: 'team-123', name: 'A different robot', cadDirectory: 'design/robot', buildDirectory: 'generated/cad'})).files).toEqual([]);
}));

test('offline CAD reference preserves installed declarations/license and rejects damaged or escaping entries',async()=>{
 const bundle=await cadReferenceBundle(),files=validateCadReference(bundle);
 expect(files['.cadcove/skills/references/brepjs-license.md']).toBe(await readFile(path.resolve(import.meta.dir,'../node_modules/brepjs/LICENSE'),'utf8'));
 expect(files['.cadcove/skills/references/brepjs-api.md']).toContain(await readFile(path.resolve(import.meta.dir,'../node_modules/brepjs/dist/index.d.ts'),'utf8'));
 const badHash=structuredClone(bundle);badHash.files[0].text+='altered';expect(()=>validateCadReference(badHash)).toThrow('Invalid CAD reference entry');
 const escaped=structuredClone(bundle);escaped.files[0].file='../model.js';expect(()=>validateCadReference(escaped)).toThrow('Invalid CAD reference entry');
 const duplicate=structuredClone(bundle);duplicate.files[1]=duplicate.files[0];expect(()=>validateCadReference(duplicate)).toThrow('Invalid CAD reference entry');
 expect(()=>validateCadReference({...bundle,version:'different'})).toThrow('Invalid CAD reference bundle');
});

test('dry run lists changes but creates nothing, including for a nonexistent workspace', () => fixture(async root => {
  const workspace = path.join(root, 'not-created');
  const result = await initializeToolbox({workspace, dryRun: true});
  expect(result.files).toContain('.cadcove/AGENT.md'); expect(result.dryRun).toBe(true);
  expect(await readdir(root)).toEqual([]);
}));

test('conflicting configuration is rejected before creating any files', () => fixture(async root => {
  await writeFile(path.join(root, 'robot.sim.json'), '{"custom":true}');
  await expect(initializeToolbox({workspace: root})).rejects.toThrow('Refusing to overwrite');
  expect(await readdir(root)).toEqual(['robot.sim.json']);
  expect(await readFile(path.join(root, 'robot.sim.json'), 'utf8')).toBe('{"custom":true}');
}));

test('initialization rejects escaping, overlapping, reserved and symlinked output paths', () => fixture(async root => {
  for (const cadDirectory of ['../outside', '/absolute', 'C:/outside', 'a\\b', '.git/cad', 'build/cadcove/source', 'cad/../other']) {
    await expect(initializeToolbox({workspace: root, cadDirectory})).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  }
  const outside = await mkdtemp(path.join(os.tmpdir(), 'cadcove-external-'));
  try {
    await symlink(outside, path.join(root, '.github'));
    await expect(initializeToolbox({workspace: root})).rejects.toThrow(/Unsafe .* path/);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(root)).toEqual(['.github']);
  } finally { await rm(outside, {recursive: true, force: true}); }
}));

test('CLI requires explicit project, returns structured errors and rejects typos without side effects', () => fixture(async root => {
  for (const args of [['doctor'], ['audit'], ['init', '--workspce', root], ['init', '--workspace', root, '--name'], ['init', '--workspace', root, '--workspace', root], ['unknown']]) {
    const {code, result} = await cli(args, root);
    expect(code).toBe(2); expect(result.ok).toBe(false); expect(result.error.message).toBeString();
    expect(await readdir(root)).toEqual([]);
  }
}));

test('sim-run startup errors preserve its newline-delimited event protocol',()=>fixture(async root=>{
 const {code,result,stdout}=await cli(['sim-run','--project','missing.json'],root);
 expect(code).toBe(2);expect(result.ok).toBe(false);
 expect(stdout.trim().split('\n')).toHaveLength(1);
}));

test('new-project doctor identifies missing build/integration and never presents scaffold as runnable', () => fixture(async root => {
  expect((await cli(['init', '--workspace', root], root)).code).toBe(0);
  const {code, result} = await cli(['doctor', '--project', 'robot.sim.json'], root);
  expect(code).toBe(1); expect(result.ok).toBe(false); expect(result.qualification).toBe('not-certified');
  expect(result.checks.find(c => c.id === 'robot-program').ok).toBe(false);
  expect(result.checks.find(c => c.id === 'compiled-project').ok).toBe(false);
  expect(result.reviewRequired).toHaveLength(6);
  const audit = await cli(['audit', '--project', 'robot.sim.json'], root);
  expect(audit.code).toBe(1); expect(audit.result.canLoad).toBe(false);
  const capabilities = await cli(['capabilities'], root);
  expect(capabilities.code).toBe(0); expect(capabilities.result.agent.providerRequired).toBe(false);
}));
