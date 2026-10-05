import { get, put, entries } from "./storage.js";

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,79}$/;
export function slug(name) {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "") || "project";
}
export function parseRoute(path) {
  if (path === "/") return null;
  const match = path.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (!match || !SEGMENT.test(match[1]) || !SEGMENT.test(match[2]) ||
      ["assets", "__models"].includes(match[1]))
    throw Error("Use a link like /project/model (lowercase letters, numbers and hyphens).");
  return { project: match[1], model: match[2] };
}
export const routePath = ({ project, model }) => `/${project}/${model}`;
export const modelKey = ({ project, model }) => `model:${project}/${model}`;
export const headKeyFor = (route) => route ? `head:${route.project}/${route.model}` : "head";
export function validEntry(entry) {
  return typeof entry === "string" && entry.endsWith(".js") &&
    !/[\\\x00-\x1f]/.test(entry) &&
    entry.split("/").every((part) => part && part !== "." && part !== ".." && !part.startsWith("."));
}
export function conventionalModels(files) {
  return Object.keys(files).sort().filter((p) => /(^|\/)(model|assembly)\.js$/.test(p))
    .map((entry) => ({ entry, model: slug(entry === "model.js" ? "model" :
      entry.replace(/\/model\.js$/, "").replace(/\.js$/, "")) }));
}
export async function projectForFolder(directory) {
  const projects = await entries("meta", "project:");
  for (const [, project] of projects) {
    try { if (await directory.isSameEntry(project.directory)) return project.id; } catch {}
  }
  const base = slug(directory.name);
  const reserved = ["assets", "__models"].includes(base) ? `${base}-project` : base;
  let id = reserved, n = 2;
  while (projects.some(([, p]) => p.id === id)) id = `${reserved.slice(0, 73)}-${n++}`;
  return id;
}
export async function registerModel(route, entry) {
  if (!validEntry(entry)) throw Error("Choose a relative JavaScript entry file inside the project.");
  parseRoute(routePath(route));
  const key = modelKey(route), existing = await get("meta", key);
  if (existing && existing.entry !== entry)
    throw Error(`The link ${routePath(route)} already points to ${existing.entry}. Choose another link name.`);
  await put("meta", key, { ...route, entry });
}
export async function directoryAt(root, segments, create = false) {
  let dir = root;
  for (const part of segments) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}
export async function artifactDirectory(root, entry, create = false) {
  const parts = entry.split("/"), file = parts.pop();
  const parent = await directoryAt(root, parts);
  const cache = await parent.getDirectoryHandle(".instantcad", { create });
  if (file === "model.js") return cache; // Preserve existing model folder caches.
  const models = await cache.getDirectoryHandle("entries", { create });
  return models.getDirectoryHandle(file, { create });
}
