export function encodeScene(scene) {
  const meta = scene.parts.map(
    ({ id, name, color, positions, normals, indices, metrics, geometryKey }) => ({
      id,
      name,
      color,
      metrics,
      ...(geometryKey ? {geometryKey} : {}),
      p: positions.length,
      n: normals.length,
      i: indices.length,
    }),
  );
  const header = new TextEncoder().encode(JSON.stringify(meta)),
    offset = (8 + header.length + 3) & ~3;
  const bytes = new ArrayBuffer(
    offset +
      scene.parts.reduce(
        (n, p) =>
          n + 4 * (p.positions.length + p.normals.length + p.indices.length),
        0,
      ),
  );
  const view = new DataView(bytes);
  view.setUint32(0, 0x31444349, true);
  view.setUint32(4, header.length, true);
  new Uint8Array(bytes, 8, header.length).set(header);
  let at = offset;
  for (const p of scene.parts)
    for (const [name, Type] of [
      ["positions", Float32Array],
      ["normals", Float32Array],
      ["indices", Uint32Array],
    ]) {
      new Type(bytes, at, p[name].length).set(p[name]);
      at += p[name].length * 4;
    }
  return bytes;
}
export function decodeScene(bytes) {
  if (bytes.byteLength < 8) throw Error("Truncated scene");
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x31444349)
    throw Error("Invalid scene format");
  const length = view.getUint32(4, true);
  if (length > bytes.byteLength - 8) throw Error("Truncated scene header");
  const meta = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 8, length)),
  );
  if (!Array.isArray(meta) || !meta.length) throw Error("Empty scene");
  let at = Math.ceil((8 + length) / 4) * 4;
  const ids = new Set();
  const parts = meta.map(({ p, n, i, ...m }) => {
    if (
      ![p, n, i].every(
        (v) => Number.isSafeInteger(v) && v > 0 && v % 3 === 0,
      ) ||
      p !== n ||
      at + 4 * (p + n + i) > bytes.byteLength
    )
      throw Error("Invalid mesh lengths");
    if (
      typeof m.id !== "string" ||
      ids.has(m.id) ||
      !/^#[0-9a-f]{6}$/i.test(m.color)
    )
      throw Error("Invalid part metadata");
    ids.add(m.id);
    const part = {
      ...m,
      positions: new Float32Array(bytes, at, p),
      normals: new Float32Array(bytes, at + p * 4, n),
      indices: new Uint32Array(bytes, at + (p + n) * 4, i),
    };
    if (
      !part.positions.every(Number.isFinite) ||
      !part.normals.every(Number.isFinite) ||
      !part.indices.every((v) => v < p / 3)
    )
      throw Error("Invalid mesh data");
    at += (p + n + i) * 4;
    return part;
  });
  if (at !== bytes.byteLength) throw Error("Unexpected scene bytes");
  return { parts };
}
