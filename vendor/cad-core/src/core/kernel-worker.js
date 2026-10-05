import * as brepjs from "../brepjs.js";
import { OcctKernel } from "occt-wasm";
import { collect } from "./geometry.js";
import { hash } from "./revision.js";
import { ComponentCache } from './component-cache.js';
const componentCache = new ComponentCache();
let owner,
  adapter,
  parts = [],
  revision,
  chain = Promise.resolve();
let exactParts = async () => parts;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const assetRequests = new Map();
let assetSerial = 0;
function hostAsset(path, context) {
  const requestId = ++assetSerial;
  return new Promise((resolve, reject) => {
    assetRequests.set(requestId, { resolve, reject });
    self.postMessage({ kind: "asset-request", requestId, path, context });
  });
}
self.onmessage = ({ data }) => {
  // Replies must bypass the command queue: a build can be awaiting these bytes.
  if (data.kind === "asset-response") {
    const request = assetRequests.get(data.requestId);
    if (request) {
      assetRequests.delete(data.requestId);
      data.error ? request.reject(Error(data.error)) : request.resolve(data.bytes);
    }
    return;
  }
  chain = chain.then(async () => {
    const start = performance.now();
    try {
      let result;
      if (data.kind === "build") {
        if (data.meshSeed) componentCache.seed(data.meshSeed);
        const cacheStarted=performance.now();
        const cache=await componentCache.begin({files:data.sourceFiles,entry:data.entry,revision:data.revision});
        const timings = {
          kernelInitMs: 0,
          moduleImportMs: 0,
          modelBuildMs: 0,
          collectMs: 0,
          finalizeMs: 0,
          cacheLookupSetupMs: performance.now()-cacheStarted,
        };
        const details = data.profile
          ? {
              fileReadMs: 0,
              assetHashMs: 0,
              assetBytes: 0,
              stepImportMs: 0,
              modelValidationMs: 0,
              modelRepairMs: 0,
              modelValidationCalls: 0,
              modelRepairCalls: 0,
              geometry: {},
            }
          : undefined;
        const progress = (text) => {
          if (data.profile) self.postMessage({ id: data.id, progress: text });
        };
        progress("Initializing the browser CAD engine…");
        const init = performance.now(),
          candidate = await OcctKernel.init({ wasm: data.wasm }),
          candidateAdapter = brepjs.OcctWasmAdapter.fromKernel(candidate);
        brepjs.registerKernel("occt-wasm", candidateAdapter);
        const kernelInitMs = performance.now() - init;
        timings.kernelInitMs = kernelInitMs;
        let phase = "module";
        if (details) {
          const step = candidate.importXCAFFromSTEP.bind(candidate);
          candidate.importXCAFFromSTEP = (...args) => {
            progress("Parsing the STEP assembly in OCCT…");
            const t = performance.now();
            try {
              return step(...args);
            } finally {
              details.stepImportMs += performance.now() - t;
              progress("Preparing and validating assembly parts…");
            }
          };
          for (const [method, key, count] of [
            ["isValid", "modelValidationMs", "modelValidationCalls"],
            ["fixShape", "modelRepairMs", "modelRepairCalls"],
          ]) {
            const fn = candidateAdapter[method].bind(candidateAdapter);
            candidateAdapter[method] = (...args) => {
              if (phase !== "model") return fn(...args);
              const t = performance.now();
              details[count]++;
              try {
                return fn(...args);
              } finally {
                details[key] += performance.now() - t;
              }
            };
          }
        }
        try {
          let mark = performance.now();
          let module;
          if (typeof data.bundle === "string") {
            // The editor host compiles imports only. User model execution stays
            // in this worker, using this exact brepjs/kernel instance.
            const cjs = { exports: {} };
            new Function("require", "module", "exports", data.bundle)(
              (name) => {
                if (name !== "brepjs") throw Error(`Unsupported model import: ${name}`);
                return brepjs;
              }, cjs, cjs.exports,
            );
            module = cjs.exports;
          } else module = await import(data.module);
          const build = module.default ?? module.build;
          timings.moduleImportMs = performance.now() - mark;
          if (typeof build !== "function")
            throw Error("model.js must export default a build function");
          phase = "model";
          mark = performance.now();
          progress('Building changed components; reusing validated geometry…');
          const output = await build({
            cache: {part:async(spec,create)=>{
              const result=await cache.part(spec,create),done=cache.stats.hits+cache.stats.misses;
              if(done%100===0)progress(`Prepared ${done.toLocaleString()} components (${cache.stats.hits.toLocaleString()} cached)…`);
              return result;
            }},
            brepjs,
            occt: candidate,
            adapter: candidateAdapter,
            async readAsset(path, expectedHash) {
              const readStarted = performance.now();
              if (!data.directory && !data.assetBridge)
                throw Error("Connect the source folder to read model assets");
              if (!/^[a-f0-9]{64}$/.test(expectedHash))
                throw Error(
                  "readAsset requires the asset SHA-256 in model source",
                );
              if (
                typeof path !== "string" ||
                path.startsWith("/") ||
                path.includes("\\") ||
                path.split("/").some((s) => !s || s === "." || s === "..")
              )
                throw Error("Use an asset path inside the connected folder");
              let bytes;
              if (data.assetBridge) bytes = await hostAsset(path, data.assetContext);
              else {
                const segments = path.split("/");
                let directory = data.directory;
                for (const segment of segments.slice(0, -1))
                  directory = await directory.getDirectoryHandle(segment);
                const file = await (await directory.getFileHandle(segments.at(-1))).getFile();
                bytes = await file.arrayBuffer();
              }
              const hashStarted = performance.now();
              if (details) {
                details.fileReadMs += hashStarted - readStarted;
                details.assetBytes += bytes.byteLength;
              }
              const actualHash = await hash(bytes);
              if (details)
                details.assetHashMs += performance.now() - hashStarted;
              if (actualHash !== expectedHash)
                throw Error(
                  `Asset changed: ${path}. Update its SHA-256 in model.js before rebuilding.`,
                );
              return new Uint8Array(bytes);
            },
          });
          timings.modelBuildMs = performance.now() - mark;
          phase = "collect";
          mark = performance.now();
          const meshed = collect(
            output,
            candidateAdapter,
            details?.geometry,
            details ? progress : undefined,
            cache,
          );
          timings.collectMs = performance.now() - mark;
          mark = performance.now();
          owner?.[Symbol.dispose]();
          owner = candidate;
          adapter = candidateAdapter;
          const items=Array.isArray(output) ? output : [output];
          parts=[];
          exactParts=async()=>{
            if (parts.length===items.length) return parts;
            progress('Preparing exact component geometry for inspection/export…');
            const prepared=[];
            for(let i=0;i<items.length;i++) {
              const p=items[i],record=cache.record(p);
              const shape=record ? await record.resolve() : (p.shape ?? p);
              if (!candidateAdapter.isValid(shape.wrapped)) throw Error(`${meshed[i].id}: OCCT reports invalid geometry`);
              prepared.push({id:meshed[i].id,shape});
            }
            parts=prepared;return parts;
          };
          cache.commit();
          revision = data.revision;
          timings.finalizeMs = performance.now() - mark;
          if (details) {
            details.modelOtherMs =
              timings.modelBuildMs -
              details.fileReadMs -
              details.assetHashMs -
              details.stepImportMs -
              details.modelValidationMs -
              details.modelRepairMs;
            details.resources = performance
              .getEntriesByType("resource")
              .map((e) => ({
                name: e.name,
                durationMs: e.duration,
                transferSize: e.transferSize,
                encodedBodySize: e.encodedBodySize,
                decodedBodySize: e.decodedBodySize,
              }));
          }
          result = {
            parts: meshed.map(p=>p.geometryKey && data.knownGeometryKeys?.includes(p.geometryKey)
              ? {id:p.id,name:p.name,color:p.color,geometryKey:p.geometryKey,reuse:true} : p),
            revision,
            timings: {
              ...timings,
              components: cache.stats,
              totalMs: performance.now() - start,
              ...(details ? { details } : {}),
            },
            ...(details
              ? {
                  transport: {
                    workerStartEpochMs: performance.timeOrigin + start,
                    workerDoneEpochMs:
                      performance.timeOrigin + performance.now(),
                  },
                }
              : {}),
          };
        } catch (error) {
          candidate[Symbol.dispose]();
          if (adapter) brepjs.registerKernel("occt-wasm", adapter);
          throw error;
        }
      } else if (data.kind === 'materialize') {
        if(!owner)throw Error('Build the model before inspecting exact geometry');
        self.postMessage({id:data.id,progress:'Preparing exact CAD geometry for inspection/export…'});
        result={parts:(await exactParts()).length};
      } else if (data.kind === "inspect") {
        if (!owner)
          throw Error("Build the model before inspecting exact geometry");
        const exact=await exactParts();
        result = await new AsyncFunction(
          "brepjs",
          "occt",
          "adapter",
          "parts",
          `"use strict";\n${data.code}`,
        )(brepjs, owner, adapter, exact);
        result = JSON.parse(JSON.stringify(result ?? null));
      } else if (data.kind === "export") {
        if (!owner) throw Error("Build the model before exporting STEP");
        result = adapter.exportSTEP((await exactParts()).map((p) => p.shape.wrapped));
      } else throw Error("Unknown worker request");
      self.postMessage({ id: data.id, ok: true, result });
    } catch (error) {
      self.postMessage({
        id: data.id,
        ok: false,
        error: String(error.stack || error),
        revision,
      });
    }
  });
};
