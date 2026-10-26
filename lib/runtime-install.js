// Shared by a VS Code host and CLI. The manifest must come from the installed,
// trusted extension release, not a remote "latest" document or workspace file.
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, lstat, mkdtemp, chmod, rename, rm, writeFile, readFile} from 'node:fs/promises';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export function validateRuntimeManifest(value, target = `${process.platform}-${process.arch}`) {
  if (!value || value.schema !== 1 || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.version) || value.target !== target || !['darwin-arm64','darwin-x64','linux-x64','linux-arm64','win32-x64','win32-arm64'].includes(target)) throw Error('Invalid or incompatible runtime manifest');
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 64) throw Error('Invalid runtime file list');
  const names = new Set();
  let total = 0;
  const files = value.files.map(file => {
    if (!file || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(file.name) || names.has(file.name.toLowerCase()) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file.name) || file.name.endsWith('.') || file.name.toLowerCase() === 'manifest.json') throw Error('Invalid runtime filename');
    names.add(file.name.toLowerCase());
    const url = new URL(file.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('Runtime downloads require HTTPS without credentials or fragments');
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 1024**3 || typeof file.executable !== 'boolean') throw Error('Invalid runtime file digest, size or permissions');
    total += file.bytes;
    return {name: file.name, url: url.href, bytes: file.bytes, sha256: file.sha256, executable: file.executable};
  });
  if (total > 2 * 1024**3) throw Error('Runtime exceeds installation size limit');
  const suffix = target.startsWith('win32-') ? '.exe' : '';
  for (const name of ['cadcove' + suffix, 'instantcad-sim' + suffix]) if (!files.some(f => f.name === name && f.executable)) throw Error(`Runtime is missing executable ${name}`);
  return {schema: 1, version: value.version, target, files};
}

async function verifyFiles(directory, manifest) {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw Error('Runtime cache path is not a regular directory');
  for (const file of manifest.files) {
    const absolute = path.join(directory, file.name), stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes) throw Error(`Runtime cache file is invalid: ${file.name}`);
    if (process.platform !== 'win32' && file.executable && !(stat.mode & 0o111)) throw Error(`Runtime is not executable: ${file.name}`);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(absolute)) digest.update(chunk);
    if (digest.digest('hex') !== file.sha256) throw Error(`Runtime cache checksum mismatch: ${file.name}`);
  }
}

// Repairs publish a fresh immutable generation. Do not replace or unlink files
// that an existing terminal, robot JVM launcher, or another editor may be using.
async function selectedDirectory(root, key) {
  const selection = path.join(root, key + '.json');
  let stat;
  try { stat = await lstat(selection); } catch (error) { if (error.code === 'ENOENT') return path.join(root, key); throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw Error('Invalid runtime selection file');
  const value = JSON.parse(await readFile(selection, 'utf8'));
  const prefix = key + '-repair-';
  if (value.schema !== 1 || typeof value.directory !== 'string' || !value.directory.startsWith(prefix) || !/^[a-f0-9-]{36}$/.test(value.directory.slice(prefix.length))) throw Error('Invalid runtime selection');
  return path.join(root, value.directory);
}

export async function installRuntime({manifest: input, cacheDirectory, repair = false, signal, onProgress = () => {}, fetchImpl = fetch}) {
  const manifest = validateRuntimeManifest(input);
  if (typeof repair !== 'boolean') throw Error('repair must be boolean');
  if (!cacheDirectory || !path.isAbsolute(cacheDirectory)) throw Error('Runtime cache directory must be absolute');
  signal?.throwIfAborted();
  const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const root = path.resolve(cacheDirectory), key = `${manifest.version}-${manifest.target}-${digest.slice(0, 24)}`;
  let directory = path.join(root, key), needsRepair = false;
  await mkdir(root, {recursive: true});
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Runtime cache root must be a regular directory');
  try {
    directory = await selectedDirectory(root, key);
    let present = false;
    try { await lstat(directory); present = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) {
      await verifyFiles(directory, manifest); signal?.throwIfAborted();
      return {schema: 1, directory, reused: true, repaired: false, manifest};
    }
    if (directory !== path.join(root, key)) throw Error('Selected runtime generation is missing');
  } catch (error) {
    signal?.throwIfAborted();
    if (!repair) throw Error(`Cached runtime requires repair at ${directory}: ${error.message}`);
    needsRepair = true;
  }
  const staging = await mkdtemp(path.join(root, '.install-'));
  let unpublished, selectionTemporary;
  async function publishRepair() {
    // A concurrent installer may already have repaired this manifest. Only a
    // complete verified generation can win; never trust the selection alone.
    try {
      const selected = await selectedDirectory(root, key);
      await verifyFiles(selected, manifest); signal?.throwIfAborted();
      return {schema: 1, directory: selected, reused: true, repaired: true, manifest};
    } catch { signal?.throwIfAborted(); }
    const generation = key + '-repair-' + randomUUID();
    directory = path.join(root, generation);
    await rename(staging, directory); unpublished = directory;
    selectionTemporary = path.join(root, '.selection-' + randomUUID());
    await writeFile(selectionTemporary, JSON.stringify({schema: 1, directory: generation}) + '\n', {flag: 'wx', mode: 0o600});
    signal?.throwIfAborted();
    try { await rename(selectionTemporary, path.join(root, key + '.json')); }
    catch (error) {
      // Windows can deny replacing a selection another installer just opened.
      // Reuse that install only after verifying its selected generation's bytes.
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
      try {
        const selected = await selectedDirectory(root, key);
        await verifyFiles(selected, manifest); signal?.throwIfAborted();
        return {schema: 1, directory: selected, reused: true, repaired: true, manifest};
      } catch { throw error; }
    }
    unpublished = undefined;
    return {schema: 1, directory, reused: false, repaired: true, manifest};
  }
  try {
    for (const file of manifest.files) {
      signal?.throwIfAborted();
      const response = await fetchImpl(file.url, {signal, redirect: 'follow'});
      if (!response.ok || !response.body) throw Error(`Runtime download failed (${response.status}): ${file.name}`);
      const hash = createHash('sha256'); let received = 0;
      const verifier = new Transform({transform(chunk, encoding, done) {
        received += chunk.length;
        if (received > file.bytes) return done(Error(`Runtime download exceeds expected size: ${file.name}`));
        hash.update(chunk);
        try { onProgress({file: file.name, received, bytes: file.bytes}); done(null, chunk); }
        catch (error) { done(error); }
      }});
      const destination = path.join(staging, file.name);
      await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(destination, {flags: 'wx', mode: 0o600}), {signal});
      if (received !== file.bytes || hash.digest('hex') !== file.sha256) throw Error(`Runtime download checksum/size mismatch: ${file.name}`);
      await chmod(destination, file.executable ? 0o755 : 0o644);
    }
    // No partially downloaded directory is ever returned as runnable. The
    // manifest is metadata only: cache reuse hashes all executable bytes again.
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    signal?.throwIfAborted();
    if (needsRepair) return await publishRepair();
    let reused = false;
    try { await rename(staging, directory); }
    catch (error) {
      // Windows reports EPERM when another installer wins the directory rename.
      // Only treat it as a race if the destination exists, then verify every byte
      // below. A permission failure without a published winner must still fail.
      if (process.platform === 'win32' && error.code === 'EPERM') {
        try { await lstat(directory); } catch { throw error; }
      } else if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      try { await verifyFiles(directory, manifest); reused = true; }
      catch (invalid) { if (repair) return await publishRepair(); throw invalid; }
    }
    return {schema: 1, directory, reused, repaired: false, manifest};
  } finally {
    await rm(staging, {recursive: true, force: true});
    if (selectionTemporary) await rm(selectionTemporary, {force: true});
    if (unpublished) await rm(unpublished, {recursive: true, force: true});
  }
}
