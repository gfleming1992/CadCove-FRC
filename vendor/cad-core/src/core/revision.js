export async function hash(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
// Hosts rebuilding the kernel inject its artifact fingerprint at bundle time.
// The default preserves cache identity for existing unmodified web deployments.
export const runtimeIdentity = typeof INSTANTCAD_RUNTIME_ID === "string"
  ? INSTANTCAD_RUNTIME_ID : "brepjs@19.0.5/occt-wasm@5.3.2/mesh-v1";
export async function snapshot(files, entry = "model.js", identity = runtimeIdentity) {
  if (typeof identity !== "string" || !identity.trim()) throw Error("Runtime identity is required");
  const sorted = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
  if (!sorted[entry]) throw Error(`The folder must contain ${entry}`);
  return {
    files: sorted,
    entry,
    revision: await hash(
      identity + "\n" +
        (entry === "model.js" ? "" : `entry:${entry}\n`) + JSON.stringify(sorted),
    ),
  };
}
