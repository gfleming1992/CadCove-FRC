import {SOURCE_LIMITS, checkSourceBudget} from './core/source-limits.js';
const SKIP = new Set(["node_modules", ".git", ".instantcad", "dist"]);
export async function readFolder(directory, prefix = "", result = {}) {
  const encoder = new TextEncoder();
  let total = Object.values(result).reduce((n, s) => n + encoder.encode(s).byteLength, 0);
  checkSourceBudget(Object.keys(result).length, total);
  async function visit(dir, base) {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.') || SKIP.has(name)) continue;
      const path = base + name;
      if (handle.kind === 'directory') {
        if (path.split('/').length > 12) throw Error('Model folder nesting is too deep');
        await visit(handle, path + '/');
      } else if (name.endsWith('.js')) {
        const file = await handle.getFile();
        if (file.size > SOURCE_LIMITS.fileBytes) throw Error(path + ' exceeds 1 MB');
        const count = Object.keys(result).length + (path in result ? 0 : 1);
        const oldBytes = encoder.encode(result[path] ?? '').byteLength;
        checkSourceBudget(count, total - oldBytes + file.size);
        const code = await file.text();
        total += encoder.encode(code).byteLength - oldBytes;
        checkSourceBudget(count, total);
        result[path] = code;
      }
    }
  }
  await visit(directory, prefix);
  return result;
}
export async function writeFile(directory, path, text) {
  if (
    !/^(?:[\w-]+\/)*[\w.-]+\.js$/.test(path) ||
    path.split("/").includes("..")
  )
    throw Error("Use a relative .js path inside the selected project");
  const segments = path.split("/");
  let parent = directory;
  for (const segment of segments.slice(0, -1))
    parent = await parent.getDirectoryHandle(segment, { create: true });
  const file = await parent.getFileHandle(segments.at(-1), { create: true }),
    writer = await file.createWritable();
  try {
    await writer.write(text);
    await writer.close();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}
