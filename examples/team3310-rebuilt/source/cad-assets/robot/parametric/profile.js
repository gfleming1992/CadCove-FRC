import {line, circle, threePointArc, wireLoop, face, extrude, cylinder, compound, cut, unwrap} from 'brepjs';

// Profiles describe manufacturing contours in millimetres. Boundary arcs remain
// true circles; holes stay explicit so edits preserve the mounting pattern.
export function buildPrismaticPart(profile, {depth = profile.depth, holeScale = 1} = {}) {
  if (!Number.isFinite(depth) || depth <= 0 || !Number.isFinite(holeScale) || holeScale <= 0) throw Error('Depth and hole scale must be positive');
  const point = ([u,v]) => profile.origin.map((p,i) => p + u*profile.u[i] + v*profile.v[i]);
  function loop(edges, isHole) {
    return unwrap(wireLoop(edges.map(edge => {
      if (edge.kind === 'line') return line(point(edge.from), point(edge.to));
      if (edge.kind === 'arc') return threePointArc(point(edge.from), point(edge.mid), point(edge.to));
      if (edge.kind === 'circle') return circle(edge.radius*(isHole ? holeScale : 1), {at:point(edge.center), axis:profile.normal});
      throw Error('Unsupported manufacturing profile curve: '+edge.kind);
    })));
  }
  const section = unwrap(face(loop(profile.outline,false), profile.cutouts.map(hole => loop(hole,true))));
  const stock = unwrap(extrude(section, profile.direction.map(v => v*depth)));
  // Cross-drilled holes are explicit machining operations, independent of the
  // stock profile. Small cutter overtravel avoids coincident Boolean faces.
  if (!profile.crossHoles?.length) return stock;
  const cutters = profile.crossHoles.map(hole => cylinder(hole.radius*holeScale, hole.length+0.00002, {
    at: hole.at.map((p,i) => p-hole.axis[i]*0.00001), axis:hole.axis
  }));
  return unwrap(cut(stock, compound(cutters)));
}
