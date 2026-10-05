export { hash, snapshot } from "./core/revision.js";
const DB = "instantcad-local-v1";
let connection;
export async function database() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => {
        for (const name of ["meta", "sources", "scenes"])
          q.result.createObjectStore(name);
      };
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  return connection;
}
export async function get(store, key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const q = db.transaction(store).objectStore(store).get(key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
export async function put(store, key, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function commit(revision, scene, expected, headKey = "head") {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["meta", "scenes"], "readwrite"),
      meta = tx.objectStore("meta");
    let conflict = false;
    const read = meta.get(headKey);
    read.onsuccess = () => {
      if (read.result !== expected) {
        conflict = true;
        tx.abort();
        return;
      }
      if (expected && expected !== revision) meta.put(expected, `previous:${headKey}`);
      meta.put(revision, headKey);
      tx.objectStore("scenes").put(scene, revision);
    };
    tx.oncomplete = resolve;
    tx.onabort = () =>
      reject(
        Error(
          conflict
            ? "Another tab committed a newer revision; refresh before rebuilding"
            : "Commit aborted",
        ),
      );
    tx.onerror = () => reject(tx.error);
  });
}
export async function trimScenes(keep) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["meta", "scenes"], "readwrite"),
      retained = new Set(keep),
      heads = tx.objectStore("meta").openCursor();
    heads.onsuccess = () => {
      const c = heads.result;
      if (c) {
        if (c.key === "head" || /^(head:|previous:)/.test(c.key)) retained.add(c.value);
        c.continue();
        return;
      }
      const q = tx.objectStore("scenes").openCursor();
      q.onsuccess = () => {
        const scene = q.result;
        if (scene) {
          if (!retained.has(scene.key)) scene.delete();
          scene.continue();
        }
      };
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function entries(store, prefix = "") {
  const db = await database();
  return new Promise((resolve, reject) => {
    const result = [], q = db.transaction(store).objectStore(store).openCursor();
    q.onsuccess = () => {
      const c = q.result;
      if (!c) return resolve(result);
      if (String(c.key).startsWith(prefix)) result.push([c.key, c.value]);
      c.continue();
    };
    q.onerror = () => reject(q.error);
  });
}
