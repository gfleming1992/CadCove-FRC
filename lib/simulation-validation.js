import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {auditRobotProject, hash} from './robot-project.js';
import {nativeExecutable} from './runtime-location.js';

// Explicit execution check, separate from the read-only artifact doctor.
// Load once, close stdin, and wait for process exit; never start a robot JVM,
// advance physics, publish session credentials, or touch an existing session.
export async function validateSimulation(project) {
  const started = performance.now();
  const audit = await auditRobotProject(project);
  const base = {schema: 1, command: 'sim-validate', project: project.profilePath,
    worldHash: audit.worldHash, reviewRequired: audit.reviewRequired,
    qualification: 'not-certified',
    scope: 'Artifact consistency and native world loading at tick zero; not robot code, vendor ABI, stepping stability or hardware fidelity'};
  if (!audit.canLoad) return {...base, ok: false, phase: 'audit', errors: audit.errors};
  try {
    const bytes = await readFile(path.join(project.build, 'world.json'));
    if (hash(bytes) !== audit.worldHash) throw Error('World changed during validation; rebuild bindings and retry');
    const world = JSON.parse(bytes);
    const load = JSON.stringify({op: 'load', world}) + '\n';
    if (Buffer.byteLength(load) > 128 * 1024 * 1024) throw Error('World exceeds the native protocol size limit');
    const input = '{"op":"capabilities"}\n' + load;
    const assetRoot = project.profile.runtime.assetRoot
      ? path.resolve(project.root, project.profile.runtime.assetRoot) : project.root;
    const nativeStarted = performance.now();
    const stdout = await new Promise((resolve, reject) => {
      const child = execFile(nativeExecutable(), [], {
        cwd: assetRoot, timeout: 30000, killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024, windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) reject(Error(error.killed
          ? 'Native validation exceeded its time/output limit'
          : `Native validation process failed: ${stderr.trim() || error.message}`));
        else resolve(stdout);
      });
      // An early native exit is reported by execFile's completion callback.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
    const lines = stdout.trim().split('\n');
    if (lines.length !== 2) throw Error('Invalid native validation protocol response');
    const capabilities = JSON.parse(lines[0]), result = JSON.parse(lines[1]);
    if (capabilities.ok !== true || world.gameplay && !capabilities.features?.includes('gameplay-mechanisms-v1') || world.gameplay?.field_conveyors?.length && !capabilities.features?.includes('practice-field-conveyors-v1') || world.gameplay?.storage_slots?.length && !capabilities.features?.includes('practice-cargo-contacts-v1')) {
      throw Error('Native simulator capabilities do not match the selected physics profile');
    }
    if (result.ok !== true) throw Error(result.error || 'Native engine rejected the world');
    if (result.state?.tick !== 0 || result.state?.time !== 0) throw Error('Native validation did not return an initial world');
    return {...base, ok: true, phase: 'native-load', tick: 0, time: 0,
      bodies: audit.bodies, joints: audit.joints, motors: audit.motors,
      nativeLoadAndExitMs: Math.round(performance.now() - nativeStarted),
      totalMs: Math.round(performance.now() - started)};
  } catch (error) {
    return {...base, ok: false, phase: 'native-load', errors: [error.message],
      totalMs: Math.round(performance.now() - started)};
  }
}
