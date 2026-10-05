// Pure data validation shared by CLI auditing and both simulation viewers.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const vector = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);

function rigid(value, label) {
  if (!vector(value, 12)) throw Error(`${label} must be a finite row-major rigid 3x4 matrix in metres`);
  const rows = [value.slice(0, 3), value.slice(4, 7), value.slice(8, 11)];
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const [a, b, c] = rows;
  const determinant = a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
  if (rows.some(row => Math.abs(dot(row, row) - 1) > 1e-4)
      || Math.abs(dot(a, b)) > 1e-4 || Math.abs(dot(a, c)) > 1e-4
      || Math.abs(dot(b, c)) > 1e-4 || Math.abs(determinant - 1) > 1e-4) {
    throw Error(`${label} must contain a proper rigid rotation, not scale, shear or reflection`);
  }
}

export function validateSceneBindings(bindings) {
  if (!record(bindings) || bindings.schema !== 1) throw Error('Invalid scene binding schema');
  for (const name of ['start', 'fieldOrigin']) {
    if (!vector(bindings[name], 3)) throw Error(`Scene ${name} must be a finite three-vector in metres`);
  }
  for (const kind of ['robot', 'field']) {
    if (!record(bindings[kind])) throw Error(`Scene ${kind} bindings must be an object`);
    for (const [id, binding] of Object.entries(bindings[kind])) {
      const label = `${kind} occurrence ${id}`;
      if (!id || !record(binding) || typeof binding.body !== 'string' || !binding.body) throw Error(`Invalid ${label} body binding`);
      if (kind === 'robot' || binding.local !== undefined) {
        if (kind === 'field' && binding.bindPosition !== undefined) throw Error(`${label} must select local or bindPosition, not both`);
        rigid(binding.local, `${label} local`);
      } else if (!vector(binding.bindPosition, 3)) {
        throw Error(`${label} needs a rigid local matrix or a finite bindPosition in metres`);
      }
    }
  }
  return bindings;
}

// Optional author-declared shaft points, expressed in mesh metres. Do not
// assume arbitrary CAD origins are on an axis. Rapier's revolute builder uses
// the same axis in both local body frames; compare against its child anchor.
export function validateBindingAxes(bindings, world) {
  if (bindings.axisChecks === undefined) return [];
  if (!Array.isArray(bindings.axisChecks)) throw Error('axisChecks must be an array');
  return bindings.axisChecks.map(check => {
    const binding = bindings[check?.kind ?? 'robot']?.[check?.instance];
    const joint = world.joints?.find(j => j.id === check?.joint);
    if (!['robot', 'field'].includes(check?.kind ?? 'robot') || !binding?.local
        || !joint || joint.kind !== 'revolute' || binding.body !== joint.child
        || !vector(check.point, 3) || !vector(joint.axis, 3)
        || !vector(joint.anchor_child, 3) || !Number.isFinite(check.toleranceM)
        || check.toleranceM <= 0 || Math.hypot(...joint.axis) < 1e-9) {
      throw Error('Invalid axis check for ' + check?.instance);
    }
    const m = binding.local, axis = joint.axis.map(v => v / Math.hypot(...joint.axis));
    const delta = [0,1,2].map(r => m[r*4+3]
      + check.point.reduce((sum,v,k) => sum + m[r*4+k]*v, 0) - joint.anchor_child[r]);
    const along = delta.reduce((sum,v,k) => sum + v*axis[k], 0);
    const errorM = Math.hypot(...delta.map((v,k) => v - along*axis[k]));
    if (errorM > check.toleranceM) throw Error(`Axis alignment failed for ${check.instance}: ${(errorM*1000).toFixed(3)} mm from ${joint.id}`);
    return {instance:check.instance, joint:joint.id, errorM};
  });
}
