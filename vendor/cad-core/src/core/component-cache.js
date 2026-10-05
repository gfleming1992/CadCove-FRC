import {init, parse} from 'es-module-lexer';
import {hash, runtimeIdentity} from './revision.js';

// Hash the full import closure, not just a builder's top-level source. Unknown
// dynamic imports conservatively depend on the entire source revision.
export async function dependencyHashes(files, revision) {
  await init;
  const hashes = new Map(await Promise.all(Object.entries(files).map(async ([p,s]) => [p,await hash(s)])));
  const graph = new Map();
  for (const [path, source] of Object.entries(files)) {
    const dependencies = [];
    try {
      for (const item of parse(source)[0]) {
        if (item.d === -2 || item.n === 'brepjs') continue;
        if (!item.n?.startsWith('.')) {dependencies.push(null);continue;}
        const segments = path.split('/').slice(0,-1);
        for (const part of item.n.split('/')) {
          if (part === '..') segments.pop(); else if (part !== '.') segments.push(part);
        }
        const resolved = segments.join('/');
        dependencies.push(hashes.has(resolved) ? resolved : null);
      }
    } catch { dependencies.push(null); }
    graph.set(path, dependencies);
  }
  const memo = new Map();
  return async dependency => {
    const path=typeof dependency==='string' ? dependency : dependency?.path;
    if (!hashes.has(path)) throw Error(`Unknown component dependency: ${path}`);
    // Assembly registries select builders, but an edit to one imported builder
    // must not invalidate every other selection in that registry.
    if (typeof dependency==='object' && dependency.transitive===false) return hashes.get(path);
    if (!memo.has(path)) {
      const seen = new Set(), visit = p => {
        if (seen.has(p)) return;
        seen.add(p);
        if (p !== null) for (const next of graph.get(p)) visit(next);
      };
      visit(path);
      memo.set(path, hash(JSON.stringify([...seen].sort().map(p => [p,p === null ? revision : hashes.get(p)]))));
    }
    return memo.get(path);
  };
}

// Stores only validated mesh data. Exact OCCT shapes belong to the current
// candidate kernel, never to this cache. Removed/old revisions are pruned on
// successful commit; failed builds cannot replace accepted cache entries.
export class ComponentCache {
  constructor(maxBytes = 256 * 1024 * 1024) { this.maxBytes=maxBytes;this.entries=new Map(); }
  seed(parts = []) {
    let bytes=0;
    for (const part of parts) {
      if (!/^[a-f0-9]{64}$/.test(part.geometryKey ?? '')) continue;
      const size=meshBytes(part);
      if (bytes+size>this.maxBytes) continue;
      this.entries.set(part.geometryKey,part);bytes+=size;
    }
  }
  async begin({files,entry,revision}) {
    const fingerprint = files?.[entry] ? await dependencyHashes(files,revision) : null;
    const rootHash = fingerprint ? await hash(files[entry]) : revision;
    const records=new WeakMap(), pending=new Map();
    const stats={hits:0,misses:0,retainedBytes:0,retainedComponents:0};
    return {
      stats,
      part: async (spec,create) => {
        if (!spec || typeof spec.id!=='string' || !spec.id || typeof create!=='function') throw Error('cache.part requires a stable id and a shape factory');
        if (!Array.isArray(spec.dependencies)) throw Error('cache.part requires explicit source dependencies (use [] for asset-only components)');
        const deps=fingerprint ? await Promise.all(spec.dependencies.map(fingerprint)) : [revision];
        const geometryKey=await hash(JSON.stringify([runtimeIdentity,'component-mesh-v1',rootHash,deps,checkedInputs(spec.inputs ?? null),create.toString()]));
        const cached=this.entries.get(geometryKey);
        let shape, resolving;
        const resolve=()=>resolving??=(async()=>{
          shape=await create();
          if (!shape?.wrapped) throw Error(`${spec.id}: component factory must return a brepjs shape`);
          return shape;
        })();
        const item={id:spec.id,name:spec.name,color:spec.color};
        if (cached) stats.hits++; else {stats.misses++;item.shape=await resolve();}
        records.set(item,{cached,geometryKey,resolve});
        return item;
      },
      record: item => records.get(item),
      remember: (item,mesh) => {
        const record=records.get(item);
        if (record) {mesh.geometryKey=record.geometryKey;pending.set(record.geometryKey,mesh);}
      },
      commit: () => {
        const retained=new Map();let bytes=0;
        for (const [key,mesh] of pending) {
          const size=meshBytes(mesh);
          if (bytes+size>this.maxBytes) continue;
          bytes+=size;retained.set(key,mesh);
        }
        this.entries=retained;stats.retainedBytes=bytes;stats.retainedComponents=retained.size;
      },
    };
  }
}
const meshBytes = p => p.positions.byteLength+p.normals.byteLength+p.indices.byteLength;
function checkedInputs(value, seen = new Set()) {
  if(value===null || typeof value==='string' || typeof value==='boolean')return value;
  if(typeof value==='number' && Number.isFinite(value))return value;
  if(typeof value!=='object' || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype))throw Error('Component inputs must be finite JSON values without cycles');
  seen.add(value);
  const result=Array.isArray(value) ? value.map(v=>checkedInputs(v,seen))
    : Object.fromEntries(Object.keys(value).sort().map(k=>[k,checkedInputs(value[k],seen)]));
  seen.delete(value);return result;
}
