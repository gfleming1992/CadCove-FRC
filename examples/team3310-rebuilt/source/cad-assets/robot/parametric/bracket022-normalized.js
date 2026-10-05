import { getKernel, castShape } from 'brepjs';
import build from './bracket022-healed.js';

export const parameters = { frontMountHoleRadius: 1.7272 };

// The intersecting bores are cut in local coordinates to avoid tiny fragments.
// Normalize the generated geometry's trim representation for later CAD edits;
// the model is constructed above from editable geometry, without a source STEP.
export default function model({ frontMountHoleRadius = 1.7272 } = {}) {
  if (!Number.isFinite(frontMountHoleRadius) || frontMountHoleRadius <= 0) throw Error('Invalid mounting bore radius');
  const k = getKernel();
  const generated = build({ frontMountHoleRadius, sewTolerance: .001 });
  const shapes = k.importSTEP(k.exportSTEP([generated.wrapped]));
  if (shapes.length !== 1 || !k.isValid(shapes[0])) throw Error('Could not normalize bracket trims');
  return castShape(shapes[0]);
}
