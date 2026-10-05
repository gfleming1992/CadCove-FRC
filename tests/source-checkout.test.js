import {test, expect} from 'bun:test';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('Windows-style Git checkout preserves authored source and pinned upstream bytes', async () => {
  const root = path.resolve(import.meta.dir, '..');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cadcove-checkout-'));
  // Exercise Git's real filters, including when host/global settings prefer CRLF.
  // No user identity, hooks, signing configuration or commit is needed.
  const env = {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(directory, 'no-global-config')};
  async function git(...args) {
    const child = Bun.spawn(['git', '-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', ...args], {cwd: directory, env, stdout: 'pipe', stderr: 'pipe'});
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code) throw Error(stderr);
    return stdout.trim();
  }
  try {
    await git('init', '--quiet');
    const files = new Map([
      ['.gitattributes', await readFile(path.join(root, '.gitattributes'))],
      ['lib/example.js', Buffer.from('export const example = true;\n')],
      ['licenses/upstream/notice.txt', Buffer.from('Upstream notice\r\nPreserve exact bytes.\r\n')],
      ['vendor/cad-core/example.js', Buffer.from('export const upstream = true;\n')],
      ['vendor/dependency/example.txt', Buffer.from('Upstream CRLF\r\n')],
      ['media/example.wasm', Buffer.from([0, 97, 115, 109, 13, 10, 0, 255])],
    ]);
    for (const [file, bytes] of files) {
      await mkdir(path.dirname(path.join(directory, file)), {recursive: true});
      await writeFile(path.join(directory, file), bytes);
    }
    await git('add', '.');
    for (const file of files.keys()) {
      // Pinned files must survive both check-in and checkout without conversion.
      expect(await git('rev-parse', ':' + file)).toBe(await git('hash-object', '--no-filters', file));
      if (file !== '.gitattributes') await rm(path.join(directory, file));
    }
    await git('checkout-index', '--all', '--force');
    for (const [file, bytes] of files) expect(await readFile(path.join(directory, file))).toEqual(bytes);
    expect(await git('diff', '--name-only')).toBe('');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
