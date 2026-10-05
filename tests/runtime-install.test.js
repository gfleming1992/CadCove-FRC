import {test, expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, readFile, writeFile, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installRuntime, validateRuntimeManifest} from '../lib/runtime-install.js';

const payload = Buffer.from('fixture executable bytes, not a real runtime');
const target = `${process.platform}-${process.arch}`;
const suffix = process.platform === 'win32' ? '.exe' : '';
const manifest = () => ({schema: 1, version: '0.1.0-test', target, files: ['cadcove', 'instantcad-sim'].map(name => ({name: name + suffix, executable: true, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), url: `https://releases.example.test/${name}${suffix}`}))});
async function fixture(fn) { const root = await mkdtemp(path.join(os.tmpdir(), 'cadcove-install-')); try { await fn(root); } finally { await rm(root, {recursive: true, force: true}); } }

test('verified runtime installs atomically and an offline repeat validates and reuses the cache', () => fixture(async cacheDirectory => {
  const input = manifest(), progress = [];
  const result = await installRuntime({manifest: input, cacheDirectory, fetchImpl: async () => new Response(payload), onProgress: p => progress.push(p)});
  expect(result.reused).toBe(false); expect(progress.length).toBeGreaterThan(0);
  expect(await readFile(path.join(result.directory, 'cadcove' + suffix))).toEqual(payload);
  if (process.platform !== 'win32') expect((await stat(path.join(result.directory, 'cadcove' + suffix))).mode & 0o111).not.toBe(0);
  const reused = await installRuntime({manifest: input, cacheDirectory, fetchImpl: () => {throw Error('Network must not be used');}});
  expect(reused.reused).toBe(true); expect(reused.directory).toBe(result.directory);
  expect((await readdir(cacheDirectory)).some(p => p.startsWith('.install-'))).toBe(false);
}));

test('wrong bytes, truncated or oversized downloads never publish a runtime or leave staging files', () => fixture(async cacheDirectory => {
  for (const bytes of [Buffer.alloc(payload.length), payload.subarray(0, 3), Buffer.concat([payload, payload])]) {
    await expect(installRuntime({manifest: manifest(), cacheDirectory, fetchImpl: async () => new Response(bytes)})).rejects.toThrow();
    expect(await readdir(cacheDirectory)).toEqual([]);
  }
}));

test('a second-file network error and cancellation preserve previous installed versions', () => fixture(async cacheDirectory => {
  const old = await installRuntime({manifest: manifest(), cacheDirectory, fetchImpl: async () => new Response(payload)});
  const next = manifest(); next.version = '0.2.0-test'; let requests = 0;
  await expect(installRuntime({manifest: next, cacheDirectory, fetchImpl: async () => ++requests === 1 ? new Response(payload) : new Response('failure', {status: 503})})).rejects.toThrow('503');
  expect(await readdir(cacheDirectory)).toEqual([path.basename(old.directory)]);
  const controller = new AbortController();
  await expect(installRuntime({manifest: next, cacheDirectory, signal: controller.signal, fetchImpl: async () => {controller.abort(); return new Response(payload);}})).rejects.toThrow();
  expect(await readdir(cacheDirectory)).toEqual([path.basename(old.directory)]);
}));

test('concurrent installs converge on one verified runtime', () => fixture(async cacheDirectory => {
  const options = {manifest: manifest(), cacheDirectory, fetchImpl: async () => new Response(payload)};
  const results = await Promise.all([installRuntime(options), installRuntime(options)]);
  expect(results[0].directory).toBe(results[1].directory);
  expect(await readdir(cacheDirectory)).toEqual([path.basename(results[0].directory)]);
}));

test('tampered executable cache is not trusted from the saved manifest', () => fixture(async cacheDirectory => {
  const input = manifest(), result = await installRuntime({manifest: input, cacheDirectory, fetchImpl: async () => new Response(payload)});
  await writeFile(path.join(result.directory, 'cadcove' + suffix), Buffer.alloc(payload.length));
  await expect(installRuntime({manifest: input, cacheDirectory, fetchImpl: () => {throw Error('No network');}})).rejects.toThrow('requires repair');
}));

test('manifest rejects path traversal, incompatible platforms, missing executables, URLs and unsafe sizes', () => {
  for (const change of [m => m.target = 'other-platform', m => m.files[0].name = '../cadcove', m => m.files[0].name = 'CON.exe', m => m.files[0].name = 'manifest.json', m => m.files[0].url = 'http://example.test/file', m => m.files[0].bytes = 0, m => m.files[0].sha256 = 'fake', m => m.files.pop(), m => m.files[0].executable = false]) {
    const m = manifest(); change(m); expect(() => validateRuntimeManifest(m)).toThrow();
  }
});

test('repair switches to verified immutable generation and preserves existing process files', () => fixture(async cacheDirectory => {
  const input=manifest(),fetchImpl=async()=>new Response(payload);
  const first=await installRuntime({manifest:input,cacheDirectory,fetchImpl});
  const corrupt=Buffer.alloc(payload.length);
  await writeFile(path.join(first.directory,'cadcove'+suffix),corrupt);
  const repaired=await installRuntime({manifest:input,cacheDirectory,fetchImpl,repair:true});
  expect(repaired.repaired).toBe(true);expect(repaired.directory).not.toBe(first.directory);
  expect(await readFile(path.join(first.directory,'cadcove'+suffix))).toEqual(corrupt);
  expect(await readFile(path.join(repaired.directory,'cadcove'+suffix))).toEqual(payload);
  const offline=await installRuntime({manifest:input,cacheDirectory,fetchImpl:()=>{throw Error('Unexpected download');}});
  expect(offline.reused).toBe(true);expect(offline.directory).toBe(repaired.directory);
  const before=await readdir(cacheDirectory);
  expect((await installRuntime({manifest:input,cacheDirectory,repair:true,fetchImpl:()=>{throw Error('Healthy repair downloaded');}})).directory).toBe(repaired.directory);
  expect(await readdir(cacheDirectory)).toEqual(before);
}));

test('failed and cancelled repairs preserve previous bytes and do not publish selection', () => fixture(async cacheDirectory => {
  const input=manifest(),first=await installRuntime({manifest:input,cacheDirectory,fetchImpl:async()=>new Response(payload)});
  await writeFile(path.join(first.directory,'cadcove'+suffix),'damaged');
  for(const cancel of [false,true]){
    const controller=new AbortController();let count=0;
    await expect(installRuntime({manifest:input,cacheDirectory,repair:true,signal:controller.signal,fetchImpl:async()=>{
      if(++count===2){if(cancel)controller.abort();else return new Response('failure',{status:503});}
      return new Response(payload);
    }})).rejects.toThrow();
    expect(await readdir(cacheDirectory)).toEqual([path.basename(first.directory)]);
    expect(await readFile(path.join(first.directory,'cadcove'+suffix),'utf8')).toBe('damaged');
  }
}));

test('tampered repair selection cannot escape cache and repair validates selected bytes again', () => fixture(async cacheDirectory => {
  const input=manifest(),fetchImpl=async()=>new Response(payload);
  const first=await installRuntime({manifest:input,cacheDirectory,fetchImpl});
  const pointer=path.join(cacheDirectory,path.basename(first.directory)+'.json');
  await writeFile(pointer,JSON.stringify({schema:1,directory:'../../elsewhere'}));
  await expect(installRuntime({manifest:input,cacheDirectory,fetchImpl})).rejects.toThrow('requires repair');
  const repaired=await installRuntime({manifest:input,cacheDirectory,fetchImpl,repair:true});
  expect(repaired.directory.startsWith(cacheDirectory+path.sep)).toBe(true);
  await writeFile(path.join(repaired.directory,'instantcad-sim'+suffix),Buffer.alloc(payload.length));
  await expect(installRuntime({manifest:input,cacheDirectory,fetchImpl})).rejects.toThrow('checksum');
  const again=await installRuntime({manifest:input,cacheDirectory,fetchImpl,repair:true});
  expect(again.directory).not.toBe(repaired.directory);
  expect(await readFile(path.join(again.directory,'instantcad-sim'+suffix))).toEqual(payload);
}));

test('concurrent repairs leave a selected verified generation and no temporary files', () => fixture(async cacheDirectory => {
  const options={manifest:manifest(),cacheDirectory,fetchImpl:async()=>new Response(payload)};
  const first=await installRuntime(options);await writeFile(path.join(first.directory,'cadcove'+suffix),'bad');
  const results=await Promise.all([installRuntime({...options,repair:true}),installRuntime({...options,repair:true})]);
  for(const result of results)expect(await readFile(path.join(result.directory,'cadcove'+suffix))).toEqual(payload);
  const selected=await installRuntime({...options,fetchImpl:()=>{throw Error('Unexpected fetch');}});
  expect(results.map(r=>r.directory)).toContain(selected.directory);
  expect((await readdir(cacheDirectory)).filter(n=>n.startsWith('.'))).toEqual([]);
}));

test('extension update uses the new pinned manifest while preserving previous version and repair generation', () => fixture(async cacheDirectory => {
  const input=manifest(),fetchImpl=async()=>new Response(payload);
  const old=await installRuntime({manifest:input,cacheDirectory,fetchImpl});
  await writeFile(path.join(old.directory,'cadcove'+suffix),'bad');
  const repaired=await installRuntime({manifest:input,cacheDirectory,fetchImpl,repair:true});
  const next=manifest();next.version='0.2.0-test';
  const updated=await installRuntime({manifest:next,cacheDirectory,fetchImpl});
  expect(updated.directory).not.toBe(repaired.directory);
  expect((await installRuntime({manifest:input,cacheDirectory,fetchImpl:()=>{throw Error('Offline rollback downloaded');}})).directory).toBe(repaired.directory);
  expect(await readFile(path.join(updated.directory,'cadcove'+suffix))).toEqual(payload);
}));
