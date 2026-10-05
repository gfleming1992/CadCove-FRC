import { get } from "./storage.js";
import { init, parse } from "es-module-lexer";
const ASSETS = __ASSETS__,
  CACHE = __CACHE__;
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      for (const key of await caches.keys())
        if (key.startsWith("instantcad-shell-") && key !== CACHE)
          await caches.delete(key);
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "cache-shell")
    event.waitUntil(
      (async () => {
        const c = await caches.open(CACHE);
        await c.addAll(["/", ...ASSETS.shell]);
      })(),
    );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET")
    return;
  if (url.pathname.startsWith("/__models/")) {
    event.respondWith(
      (async () => {
        try {
          const [, , revision, run, ...segments] = url.pathname.split("/");
          if (!/^[a-f0-9]{64}$/.test(revision) || !run)
            throw Error("Invalid project revision");
          const source = await get("sources", revision),
            path = decodeURIComponent(segments.join("/")),
            code = source?.files[path];
          if (typeof code !== "string")
            return new Response(
              `throw Error(${JSON.stringify("Missing project module: " + path)})`,
              { status: 404, headers: { "Content-Type": "text/javascript" } },
            );
          await init;
          const [imports] = parse(code);
          let rewritten = code;
          for (const entry of imports.toReversed()) {
            if (!entry.n) continue;
            let target = entry.n;
            if (target === "brepjs") target = ASSETS.brepjs;
            else if (
              target.startsWith(".") ||
              target.startsWith("/__models/")
            ) {
              const resolved = new URL(target, url);
              if (
                !resolved.pathname.startsWith(`/__models/${revision}/${run}/`)
              )
                throw Error("Import leaves the source project");
              continue;
            } else
              throw Error(
                `Unsupported external import ${target}; use brepjs or local .js modules`,
              );
            rewritten =
              rewritten.slice(0, entry.s) +
              (entry.d >= 0 ? JSON.stringify(target) : target) +
              rewritten.slice(entry.e);
          }
          return new Response(rewritten, {
            headers: {
              "Content-Type": "text/javascript",
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          return new Response(`throw Error(${JSON.stringify(String(error))})`, {
            headers: { "Content-Type": "text/javascript" },
          });
        }
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const c = await caches.open(CACHE);
      if (url.pathname.startsWith("/assets/")) {
        const cached = await c.match(event.request);
        if (cached) return cached;
        const r = await fetch(event.request);
        if (r.ok) await c.put(event.request, r.clone());
        return r;
      }
      try {
        return await fetch(event.request);
      } catch (error) {
        const cached = await c.match(
          event.request.mode === "navigate" ? "/" : event.request,
        );
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
