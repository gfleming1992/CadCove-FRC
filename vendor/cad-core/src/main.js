import { CadClient } from "./core/cad-client.js";
import { createBrowserHost } from "./hosts/browser.js";
import { Viewer } from "./viewer.js";
import { get, put, commit, trimScenes, snapshot, hash, entries } from "./storage.js";
import { readFolder, writeFile } from "./mirror.js";
import { decodeScene, encodeScene } from "./mesh.js";
import { parseRoute, routePath, modelKey, headKeyFor, conventionalModels, projectForFolder,
  registerModel, directoryAt, artifactDirectory, slug } from "./projects.js";
let route, projectRecord, entry = "model.js", routeError;
try { route = parseRoute(location.pathname); } catch (error) { routeError = error; }
const sourceSnapshot = (files) => snapshot(files, entry);
const currentHeadKey = () => headKeyFor(route);
const assets = globalThis.ASSETS,
  canvas = document.getElementById("canvas"),
  status = document.getElementById("status"),
  buildButton = document.getElementById("build"),
  connectButton = document.getElementById("connect"),
  stopButton = document.getElementById("stop");
const started = performance.now(),
  profile = {},
  viewer = new Viewer(canvas);
const query = new URLSearchParams(location.search),
  profiling = query.get("profile") === "1",
  forceFresh = query.get("fresh") === "1";
let folder,
  head,
  displayedRevision,
  building = false,
  connecting = false,
  lastAttempt,
  workerRevision,
  generation = 0,
  polling = false,
  externalError = "",
  latestFiles = {},
  lastResult;
const channel = new BroadcastChannel("instantcad-local");
const host = createBrowserHost(assets);
const cad = new CadClient({ createWorker: host.createWorker, onProgress: message,
  onCancel: () => { generation++; workerRevision = undefined; } });
function message(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}
function summary() {
  return {
    project: route?.project ?? null,
    model: route?.model ?? null,
    entry,
    url: route ? new URL(routePath(route), location.origin).href : null,
    revision: head ?? null,
    folder: folder?.name ?? null,
    building,
    connecting,
    workerLoaded: cad.loaded,
    workerRevision: workerRevision ?? null,
    files: Object.keys(latestFiles),
    parts: viewer.scene?.parts.map(({ id, name, color, metrics }) => ({
      id,
      name,
      color,
      metrics,
    })),
    camera: structuredClone(viewer.camera),
    profile,
    frames: viewer.frames,
    gpuBytes: viewer.gpuBytes ?? 0,
    error: externalError,
  };
}
const rpc = (kind, body = {}, timeout) => cad.request(kind, body, timeout);
const cancel = (reason) => cad.cancel(reason);
async function writeArtifact(name, data) {
  if (!folder) return;
  const dir = await artifactDirectory(folder, entry, true),
    handle = await dir.getFileHandle(name, { create: true }),
    out = await handle.createWritable();
  try {
    await out.write(data);
    await out.close();
  } catch (error) {
    await out.abort();
    throw error;
  }
}
async function artifacts(result, scene, trace) {
  if (!folder) return;
  let mark = performance.now();
  const lap = (key) => {
    const now = performance.now();
    if (trace) trace[key] = now - mark;
    mark = now;
  };
  try {
    await writeArtifact("status.json", JSON.stringify(result, null, 2));
    lap("statusDiskWriteMs");
    if (scene) {
      const binary = encodeScene(scene);
      lap("meshEncodeMs");
      await writeArtifact("scene.bin", binary);
      lap("meshDiskWriteMs");
      const meshHash = await hash(binary);
      lap("meshHashMs");
      await writeArtifact(
        "scene.json",
        JSON.stringify({
          revision: head,
          meshHash,
          runtime: "brepjs@19.0.5/occt-wasm@5.3.2",
        }),
      );
      lap("metadataDiskWriteMs");
      viewer.render();
      await viewer.device.queue.onSubmittedWorkDone();
      lap("previewRenderWaitMs");
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      lap("pngReadbackEncodeMs");
      if (blob) await writeArtifact("preview.png", blob);
      lap("pngDiskWriteMs");
      if (trace) {
        trace.meshBytes = binary.byteLength;
        trace.previewBytes = blob?.size ?? 0;
      }
    }
  } catch (error) {
    if (trace) trace.error = error.message;
    message(
      `Model ready; could not save mirror artifacts: ${error.message}`,
      true,
    );
  }
}
async function sources() {
  if (folder) return readFolder(folder);
  if (Object.keys(latestFiles).length) return latestFiles;
  const files = await fetch(assets.example).then((r) => r.json());
  return files;
}
async function executeSource(revision) {
  const source=await get('sources',revision);
  if(!cad.loaded && viewer.scene)cad.scene=viewer.scene;
  return rpc("build", {
    sourceFiles:source?.files,
    entry,
    revision,
    profile: profiling,
    directory: folder ? await directoryAt(folder, entry.split("/").slice(0, -1)) : undefined,
    wasm: new URL(assets.wasm, location.href).href,
    module: host.modelModule(revision, entry),
  });
}
async function build() {
  if (building) throw Error("A build is already running");
  if (routeError) throw routeError;
  if (route && !folder) throw Error("Reconnect this project folder before building.");
  building = true;
  externalError = "";
  buildButton.disabled = true;
  stopButton.hidden = false;
  const start = performance.now(),
    expected = head,
    activeFolder = folder,
    epoch = generation;
  const trace = profiling
    ? {
        createdAt: new Date().toISOString(),
        origin: location.origin,
        forceFresh,
        workerWasWarm: cad.loaded,
        stages: {},
        disk: {},
      }
    : undefined;
  let mark = start;
  const lap = (key) => {
    const now = performance.now();
    if (trace) trace.stages[key] = now - mark;
    mark = now;
  };
  try {
    latestFiles = await sources();
    const source = await sourceSnapshot(latestFiles);
    lap("sourceReadHashMs");
    lastAttempt = source.revision;
    await put("sources", source.revision, source);
    lap("sourceIndexedDbWriteMs");
    message("Loading local CAD engine and building…");
    const scene = await executeSource(source.revision);
    lap("workerRoundTripMs");
    workerRevision = source.revision;
    if (epoch !== generation) throw Error("Build canceled");
    if (
      folder !== activeFolder ||
      (folder &&
        (await sourceSnapshot(await readFolder(folder))).revision !== source.revision)
    )
      throw Error(
        "Source changed during the build; rebuilding the newer files",
      );
    lap("sourceRecheckMs");
    await commit(source.revision, scene, expected, currentHeadKey());
    lap("sceneIndexedDbCommitMs");
    head = source.revision;
    viewer.setScene(scene, !expected);
    displayedRevision = head;
    lap("cpuMeshPackAndGpuUploadSubmitMs");
    if (trace) viewer.render();
    lap("renderCommandSubmitMs");
    await viewer.device.queue.onSubmittedWorkDone();
    lap("gpuQueueWaitMs");
    if (trace) trace.firstRobotGpuCompleteMs = performance.now() - start;
    await trimScenes([head, expected].filter(Boolean));
    lap("cachePruneMs");
    channel.postMessage({ revision: head, headKey: currentHeadKey() });
    profile.lastBuildMs = performance.now() - start;
    message(
      `${scene.parts.length} part(s) · ${scene.parts.reduce((n, p) => n + p.indices.length / 3, 0).toLocaleString()} triangles · ${(profile.lastBuildMs / 1000).toFixed(2)} s build · saved locally`,
    );
    lastResult = {
      ok: true,
      revision: head,
      parts: summary().parts,
      timings: scene.timings,
    };
    await artifacts(lastResult, scene, trace?.disk);
    if (trace) {
      trace.totalMs = performance.now() - start;
      trace.worker = scene.timings;
      trace.revision = head;
      trace.parts = scene.parts.length;
      trace.triangles = scene.parts.reduce(
        (n, p) => n + p.indices.length / 3,
        0,
      );
      trace.colors = new Set(scene.parts.map((p) => p.color)).size;
      trace.gpuBufferBytes = viewer.gpuBytes;
      trace.startup = {
        gpuInitMs: profile.gpuInitMs,
        source: profile.source,
        firstSceneMs: profile.firstSceneMs,
        navigation: performance.getEntriesByType("navigation")[0]?.toJSON(),
      };
      trace.notes = [
        "Times are wall clock, not exclusive CPU/GPU execution time.",
        "Total starts when build() begins; excludes folder-picker interaction and app startup.",
        "First robot GPU complete waits for submitted work; not a measured physical screen presentation timestamp.",
        "Report-file write is excluded from total.",
      ];
      profile.lastBuildTrace = trace;
      await writeArtifact("profile.json", JSON.stringify(trace, null, 2));
    }
    return lastResult;
  } catch (error) {
    externalError = error.message;
    lastResult = { ok: false, error: error.message, revision: head ?? null };
    message(error.message, true);
    await artifacts(lastResult);
    throw error;
  } finally {
    building = false;
    buildButton.disabled = false;
    stopButton.hidden = true;
  }
}
async function scan() {
  if (!folder || polling || building || connecting || document.hidden) return;
  polling = true;
  try {
    const source = await sourceSnapshot(await readFolder(folder));
    if (source.revision === lastAttempt) return;
    // Wait for an editor's multi-file save to settle before compiling.
    await new Promise((r) => setTimeout(r, 180));
    if ((await sourceSnapshot(await readFolder(folder))).revision !== source.revision)
      return;
    latestFiles = source.files;
    await build();
  } catch (error) {
    if (route && ["NotFoundError", "NotAllowedError"].includes(error.name)) reconnect(error.message);
    else message(error.message, true);
  } finally {
    polling = false;
  }
}
function showRoute() {
  document.getElementById("name").textContent = route ? `${route.project} / ${route.model}` : "LOCAL WORKSPACE";
  document.title = route ? `${route.project} / ${route.model} · InstantCAD` : "InstantCAD · Local";
  buildButton.disabled = !!route && !folder;
}
function reconnect(error) {
  folder = undefined;
  buildButton.disabled = true;
  connectButton.textContent = "Reconnect folder";
  connectButton.onclick = connectFolder;
  message(`${routePath(route)}: ${error}. Choose the project folder to reconnect.`, true);
}
async function attach(directory) {
  if (building || connecting) throw Error("Wait for the current build to finish");
  connecting = true;
  connectButton.disabled = true;
  try {
    const files = await readFolder(directory);
    const wasRoot = !route;
    if (wasRoot && !Object.keys(files).length) {
      Object.assign(files, await fetch(assets.example).then((r) => r.json()));
      for (const [path, text] of Object.entries(files)) await writeFile(directory, path, text);
    }
    const project = route?.project ?? await projectForFolder(directory);
    const models = conventionalModels(files);
    if (!route) {
      const first = models.find((m) => m.entry === "model.js") ?? models[0];
      if (!first) throw Error("No model.js or assembly.js found. Open a /project/model link to choose another entry file.");
      route = { project, model: first.model };
    }
    const mapping = await get("meta", modelKey(route));
    let chosen = mapping?.entry ?? models.find((m) => m.model === route.model)?.entry;
    if (!chosen || !files[chosen]) {
      chosen = await chooseEntry(files, route, mapping?.entry);
      if (!chosen) throw Error("No entry selected");
      // A reconnect does not silently redirect an existing link to different code.
      if (mapping && chosen !== mapping.entry) throw Error(`This link expects ${mapping.entry}. Select the folder containing that file.`);
    }
    await registerModel(route, chosen);
    for (const model of models) {
      const target = { project, model: model.model };
      if (!await get("meta", modelKey(target))) await registerModel(target, model.entry);
    }
    projectRecord = { id: project, name: directory.name, directory };
    await put("meta", `project:${project}`, projectRecord);
    entry = chosen;
    folder = directory;
    latestFiles = files;
    head = await get("meta", currentHeadKey());
    history.replaceState(null, "", routePath(route) + location.search);
    await put("meta", "lastRoute", routePath(route));
    // The old single-folder slot is migrated once; it must not select other projects.
    await put("meta", "folder", undefined);
    showRoute();
    connectButton.textContent = "Change folder";
    buildButton.textContent = "Rebuild";
    const source = await sourceSnapshot(latestFiles);
    lastAttempt = undefined;
    if (!forceFresh && head === source.revision) {
      if (displayedRevision === head) {
        lastAttempt = head;
        message(`${viewer.scene.parts.length} part(s) restored locally · ${routePath(route)}`);
        return;
      }
      const cached = await get("scenes", head);
      if (cached) {
        lastAttempt = head;
        viewer.setScene(cached, true);
        displayedRevision = head;
        message(`${cached.parts.length} part(s) restored locally · ${routePath(route)}`);
        return;
      }
    }
    try {
      if (forceFresh) throw Error("Fresh import requested");
      const artifacts = await artifactDirectory(folder, entry),
        metadata = JSON.parse(await (await (await artifacts.getFileHandle("scene.json")).getFile()).text());
      if (metadata.revision === source.revision) {
        const binary = await (await (await artifacts.getFileHandle("scene.bin")).getFile()).arrayBuffer();
        if (metadata.meshHash !== await hash(binary)) throw Error("Disk mesh integrity mismatch");
        const scene = decodeScene(binary);
        await put("sources", source.revision, source);
        await commit(source.revision, scene, head, currentHeadKey());
        head = source.revision;
        lastAttempt = head;
        viewer.setScene(scene, true);
        displayedRevision = head;
        message(`${scene.parts.length} part(s) restored from disk · ${routePath(route)}`);
        return;
      }
    } catch { /* First build or outdated mirror: compile source below. */ }
    await build();
  } catch (error) {
    if (route && !folder) reconnect(error.message);
    throw error;
  } finally {
    connecting = false;
    connectButton.disabled = false;
    connectButton.onclick = connectFolder;
    showRoute();
  }
}
const connectFolder = async () => {
  try {
    if (!window.showDirectoryPicker)
      throw Error(
        "Folder mirroring needs Chrome or Edge. The example and browser cache still work here.",
      );
    const handle = await window.showDirectoryPicker({
      id: "instantcad-workspace",
      mode: "readwrite",
    });
    await attach(handle);
    navigator.storage.persist?.().catch(() => {});
  } catch (error) {
    if (error.name !== "AbortError") message(error.message, true);
  }
};
connectButton.onclick = connectFolder;
// Entries are explicit: helper modules are never executed merely because they
// are present in a project folder.
function chooseEntry(files, target, expected) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog"), form = document.createElement("form");
    form.method = "dialog";
    const label = document.createElement("label"), select = document.createElement("select");
    label.textContent = expected ? `Reconnect a folder containing ${expected}` : `Entry for ${routePath(target)}`;
    select.setAttribute("aria-label", "Scene entry file");
    for (const path of Object.keys(files).sort()) select.add(new Option(path, path));
    const open = document.createElement("button"), cancel = document.createElement("button");
    open.textContent = "Open scene"; open.value = "open"; open.disabled = !select.options.length || !!expected;
    cancel.textContent = "Cancel"; cancel.value = "cancel";
    form.append(label, select, open, cancel); dialog.append(form); document.body.append(dialog);
    dialog.onclose = () => { const chosen = dialog.returnValue === "open" ? select.value : null; dialog.remove(); resolve(chosen); };
    dialog.showModal();
  });
}
const modelsButton = document.createElement("button");
modelsButton.id = "models";
modelsButton.textContent = "Models";
document.querySelector("nav").prepend(modelsButton);
modelsButton.onclick = async () => {
  if (building || connecting) return message("Wait for the current build to finish.");
  const dialog = document.createElement("dialog"), title = document.createElement("h3"), list = document.createElement("div");
  title.textContent = "Local model links";
  for (const [, model] of await entries("meta", "model:")) {
    const link = document.createElement("a");
    link.href = routePath(model);
    link.textContent = `${model.project} / ${model.model} — ${model.entry}`;
    list.append(link);
  }
  dialog.append(title, list);
  const newProject = document.createElement("a");
  newProject.href = "/?connect=1";
  newProject.textContent = "Connect another project folder";
  dialog.append(newProject);
  if (folder && route) {
    const form = document.createElement("form"), label = document.createElement("label"), select = document.createElement("select"), name = document.createElement("input"), add = document.createElement("button"), error = document.createElement("p");
    label.textContent = "Link another scene in this project";
    select.setAttribute("aria-label", "Scene entry file");
    for (const path of Object.keys(await readFolder(folder)).sort()) select.add(new Option(path, path));
    name.setAttribute("aria-label", "Model link name"); name.required = true; name.pattern = "[a-z0-9][a-z0-9-]{0,79}";
    const suggest = () => { name.value = slug(select.value.replace(/\/model\.js$/, "").replace(/\.js$/, "")); };
    select.onchange = suggest; suggest();
    add.textContent = "Open link";
    form.append(label, select, name, add, error);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const target = { project: route.project, model: name.value };
        await registerModel(target, select.value);
        location.assign(routePath(target));
      } catch (e) { error.textContent = e.message; }
    };
    dialog.append(form);
  }
  const close = document.createElement("button"); close.textContent = "Close"; close.onclick = () => dialog.close();
  dialog.append(close); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
};
buildButton.onclick = () => build().catch(() => {});
stopButton.onclick = () => cancel();
document.getElementById("fit").onclick = () => viewer.fit();
const inspectButton = document.createElement("button");
inspectButton.textContent = "Inspect";
document.querySelector("nav").append(inspectButton);
inspectButton.onclick = async () => {
  const code = prompt(
    "JavaScript in the live CAD worker. Available: brepjs, occt, adapter, parts.",
    "return parts.map(p => ({id:p.id,volume:adapter.volume(p.shape.wrapped),bounds:adapter.boundingBox(p.shape.wrapped)}));",
  );
  if (code === null) return;
  try {
    const result = await inspect(code);
    message(JSON.stringify(result));
  } catch (error) {
    message(error.message, true);
  }
};
async function inspect(code) {
  if (building) throw Error("Wait for the build to finish");
  if (!head) throw Error("Build the example or connect a folder first");
  if (workerRevision !== head) {
    await executeSource(head);
    workerRevision = head;
  }
  const result = await rpc("inspect", { code }, 15000);
  await artifacts({ ok: true, revision: head, inspection: result });
  return result;
}
window.instantcad = Object.freeze({
  version: 1,
  state: summary,
  readFiles: () => structuredClone(latestFiles),
  async listModels() { return (await entries("meta", "model:")).map(([, m]) => ({ ...m, url: new URL(routePath(m), location.origin).href })); },
  sync: scan,
  build,
  cancel,
  inspect,
  capture: () => viewer.capture(),
  fit: () => viewer.fit(),
  view: (name) => viewer.view(name),
  async writeFiles(changes, expectedRevision) {
    if (building) throw Error("Wait for the build to finish");
    if (expectedRevision !== head) throw Error("Stale revision");
    const before = await sourceSnapshot(await sources());
    if (folder && before.revision !== head)
      throw Error("Disk files have changed; sync first");
    for (const [path, code] of Object.entries(changes)) {
      if (
        typeof code !== "string" ||
        !path.endsWith(".js") ||
        path.split("/").includes("..")
      )
        throw Error("Write JavaScript source inside the project");
      if (folder) await writeFile(folder, path, code);
      latestFiles[path] = code;
    }
    return build();
  },
  async exportSTEP() {
    if (!head) throw Error("Build first");
    if (workerRevision !== head) {
      await executeSource(head);
      workerRevision = head;
    }
    return rpc("export");
  },
});
channel.onmessage = async ({ data }) => {
  if (data.headKey !== currentHeadKey()) return;
  if (building || connecting || folder) return;
  const other = await get("meta", currentHeadKey());
  if (other && other !== head) {
    const scene = await get("scenes", other);
    if (scene) {
      head = other;
      viewer.setScene(scene);
      displayedRevision = head;
      message("Scene updated by another tab");
    }
  }
};
(async () => {
  try {
    const gpu = viewer.init().then(() => {
      profile.gpuInitMs = performance.now() - started;
    });
    if (routeError) throw routeError;
    if (!route && query.get("connect") !== "1") {
      const last = await get("meta", "lastRoute");
      if (last) {
        route = parseRoute(last);
        history.replaceState(null, "", last + location.search);
      }
    }
    if (route) {
      projectRecord = await get("meta", `project:${route.project}`);
      entry = (await get("meta", modelKey(route)))?.entry ?? "model.js";
      showRoute();
    }
    const sceneTask = (async () => {
      head = await get("meta", currentHeadKey());
      const cached = head ? await get("scenes", head) : undefined;
      if (cached) {
        profile.source = "indexeddb";
        latestFiles = (await get("sources", head))?.files ?? {};
        return cached;
      }
      if (route) return undefined;
      profile.source = "bundled-preview";
      return decodeScene(
        await fetch(assets.scene).then((r) => r.arrayBuffer()),
      );
    })();
    const [scene] = await Promise.all([sceneTask, gpu]);
    if (scene) {
      viewer.setScene(scene, true);
      displayedRevision = head;
    }
    viewer.render();
    await viewer.device.queue.onSubmittedWorkDone();
    profile.firstSceneMs = performance.now() - started;
    message(
      scene ? `${scene.parts.length} part(s) · ${profile.source === "indexeddb" ? "restored locally" : "example preview"}` : "Choose the project folder to open this model.",
    );
    document.body.dataset.ready = "true";
    await host.warmShell();
    const saved = projectRecord?.directory ?? (!route && query.get("connect") !== "1" ? await get("meta", "folder") : undefined);
    if (saved) {
      try {
        if (await saved.queryPermission({ mode: "readwrite" }) === "granted") await attach(saved);
        else {
          connectButton.textContent = "Reconnect folder";
          message("Folder permission is needed. Click Reconnect folder; if it moved, choose its new location.");
          buildButton.disabled = !!route;
          connectButton.onclick = async () => {
            try {
              if (await saved.requestPermission({ mode: "readwrite" }) !== "granted")
                throw Error("Folder permission was not granted");
              await attach(saved);
            } catch (error) {
              if (route) reconnect(error.message);
              else { message(error.message, true); connectButton.onclick = connectFolder; }
            }
          };
        }
      } catch (error) {
        if (route) reconnect(error.message);
        else message(`Reconnect folder: ${error.message}`, true);
      }
    } else if (route) reconnect("No folder is connected in this browser");
    setInterval(scan, 1000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        viewer.request();
        void scan();
      }
    });
  } catch (error) {
    message(error.message, true);
    console.error(error);
  }
})();
