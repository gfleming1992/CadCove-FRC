import * as b from 'brepjs';
import build from './bracket022-normalized.js';
export const parameters = { frontMountHoleRadius: 1.7272, counterboreDiameter: 7.9375 };

// Opposite-hand bracket preserves the mounting layout and rear access bore.
export default function model({ frontMountHoleRadius = 1.7272, counterboreDiameter = 7.9375 } = {}) {
  if (!Number.isFinite(counterboreDiameter) || counterboreDiameter <= 0) throw Error('Invalid access counterbore diameter');
  const mirrored = b.mirror(build({ frontMountHoleRadius }), { at: [0, -173.4981036, 0], normal: [0, 1, 0] });
  const result = b.unwrap(b.cut(mirrored, b.cylinder(counterboreDiameter / 2, 50, { at: [-342.138, -142.0656036, 377.3932], axis: [0, 1, 0] })));
  const k = b.getKernel(), normalized = k.importSTEP(k.exportSTEP([result.wrapped]));
  if (normalized.length !== 1 || !k.isValid(normalized[0])) throw Error('Could not normalize mirrored bracket');
  return b.castShape(normalized[0]);
}
