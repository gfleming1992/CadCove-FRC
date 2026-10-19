import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Replaced at compile time for a standalone CLI; the source checkout does not
// need or define a global. Never resolve files inside Bun's virtual filesystem.
export const bundledRuntime = typeof CADCOVE_BUNDLED !== 'undefined' && CADCOVE_BUNDLED;
export const externalBun = typeof CADCOVE_EXTERNAL_BUN !== 'undefined' && CADCOVE_EXTERNAL_BUN;
export const runtimeVersion = typeof CADCOVE_VERSION !== 'undefined' ? CADCOVE_VERSION : '0.1.0-dev';
export const runtimeRoot = bundledRuntime
  ? (typeof CADCOVE_EXTERNAL_BUN !== 'undefined' && CADCOVE_EXTERNAL_BUN
    ? path.dirname(fileURLToPath(import.meta.url)) : path.dirname(process.execPath))
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function nativeExecutable(project) {
  const custom = project?.profile?.runtime?.customSimulator;
  if (custom) {
    validateCustomSimulator(custom);
    return path.join(project.build, 'custom-simulator', 'release', custom.binary + (process.platform === 'win32' ? '.exe' : ''));
  }
  return process.env.INSTANTCAD_SIM_BINARY
    ? path.resolve(process.env.INSTANTCAD_SIM_BINARY)
    : path.join(runtimeRoot, ...(bundledRuntime ? [] : ['target', 'release']), process.platform === 'win32' ? 'instantcad-sim.exe' : 'instantcad-sim');
}

export function validateCustomSimulator(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).some(k => !['sourceDirectory','package','binary','features'].includes(k)) ||
      typeof config.sourceDirectory !== 'string' || !config.sourceDirectory.trim() ||
      typeof config.package !== 'string' || typeof config.binary !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.package ?? '') ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.binary ?? '') ||
      config.features !== undefined && (!Array.isArray(config.features) || config.features.some(f => typeof f !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/.test(f)))) {
    throw Error('Invalid runtime.customSimulator: supply sourceDirectory, package, binary and optional features');
  }
  return config;
}

export function requireMechanismCapabilities(info, mechanisms) {
  if (mechanisms === undefined) return;
  if (!Array.isArray(mechanisms)) throw Error('world.mechanisms must be an array');
  if (!mechanisms.length) return;
  if (!Array.isArray(info.features) || !info.features.includes('custom-mechanisms-v1') ||
      !Array.isArray(info.mechanisms) || mechanisms.some(m => !m || typeof m.kind !== 'string' || !info.mechanisms.includes(m.kind))) {
    throw Error('Native simulator lacks the selected custom mechanism kinds. Build the matching custom simulator.');
  }
}
