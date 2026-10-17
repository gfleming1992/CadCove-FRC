export async function hash(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
// Native builds supply the exact worker fingerprint; generic snapshots use this schema.
export const runtimeIdentity = "cadquery-native/mesh-v1";
export async function snapshot(files, entry = "models.py", identity = runtimeIdentity) {
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
        `entry:${entry}\n` + JSON.stringify(sorted),
    ),
  };
}
