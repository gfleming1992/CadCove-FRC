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
export function nativeExecutable() {
  return process.env.INSTANTCAD_SIM_BINARY
    ? path.resolve(process.env.INSTANTCAD_SIM_BINARY)
    : path.join(runtimeRoot, ...(bundledRuntime ? [] : ['target', 'release']), process.platform === 'win32' ? 'instantcad-sim.exe' : 'instantcad-sim');
}
