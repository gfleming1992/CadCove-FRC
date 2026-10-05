export function collect(result, adapter, profile, progress, cache) {
  const parts = Array.isArray(result) ? result : [result],
    ids = new Set();
  if (!parts.length)
    throw Error(
      "Return a brepjs shape or a nonempty array of {id, name, color, shape}",
    );
  if (profile)
    Object.assign(profile, {
      validationMs: 0,
      tessellationMs: 0,
      meshCopyValidationMs: 0,
      volumeMs: 0,
      boundsMs: 0,
      partCount: parts.length,
      slowestParts: [],
    });
  const resultParts = parts.map((item, index) => {
    const start = performance.now(),
      times = {};
    let mark = start;
    const lap = (key) => {
      const now = performance.now();
      times[key] = now - mark;
      mark = now;
    };
    if (index % 100 === 0)
      progress?.(
        `Tessellating ${index.toLocaleString()} / ${parts.length.toLocaleString()} parts…`,
      );
    const id = String(item.id ?? `part-${index + 1}`);
    if (ids.has(id)) throw Error(`Duplicate part ID: ${id}`);
    ids.add(id);
    const metadata={id,name:String(item.name ?? id),color:/^#[a-f0-9]{6}$/i.test(item.color) ? item.color : '#cb7952'};
    const cached=cache?.record(item)?.cached;
    if (cached) {
      const mesh={...cached,...metadata};
      cache.remember(item,mesh);
      return mesh;
    }
    const shape = item?.shape ?? item;
    if (!shape?.wrapped)
      throw Error(`Part ${index + 1} is not a brepjs shape. Unwrap Result values with brepjs.unwrap().`);
    if (!adapter.isValid(shape.wrapped))
      throw Error(`${id}: OCCT reports invalid geometry`);
    lap("validationMs");
    const mesh = adapter.mesh(shape.wrapped, {
      tolerance: 0.12,
      angularTolerance: 0.35,
    });
    lap("tessellationMs");
    const positions = new Float32Array(mesh.vertices),
      normals = new Float32Array(mesh.normals),
      indices = new Uint32Array(mesh.triangles);
    if (
      positions.length % 3 ||
      normals.length !== positions.length ||
      !positions.every(Number.isFinite) ||
      !normals.every(Number.isFinite) ||
      indices.some((i) => i >= positions.length / 3)
    )
      throw Error(`${id}: invalid tessellation`);
    lap("meshCopyValidationMs");
    const volume = adapter.volume(shape.wrapped);
    lap("volumeMs");
    const bounds = adapter.boundingBox(shape.wrapped);
    lap("boundsMs");
    if (profile) {
      for (const [key, value] of Object.entries(times)) profile[key] += value;
      profile.slowestParts.push({
        id,
        name: String(item.name ?? id),
        triangles: indices.length / 3,
        totalMs: performance.now() - start,
        ...times,
      });
    }
    const result = {
      ...metadata,
      positions,
      normals,
      indices,
      metrics: {
        valid: true,
        volume,
        bounds,
        triangles: indices.length / 3,
      },
    };
    cache?.remember(item,result);
    return result;
  });
  if (profile)
    profile.slowestParts = profile.slowestParts
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 20);
  return resultParts;
}
