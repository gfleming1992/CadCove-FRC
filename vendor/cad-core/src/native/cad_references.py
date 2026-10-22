"""Explicit semantic reference queries, resolved against current OCCT geometry.

This is not FreeCAD topological naming, nor a heuristic remapper. An authored
datum describes the intended feature; zero or multiple matches are errors.
Resolve after edits instead of storing Face17. Imported STEP needs reviewed
datums; no hidden inference or automatic change to joint attachments.
"""
import hashlib
import io
import math
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.TopTools import TopTools_FormatVersion_VERSION_1


class ReferenceError(ValueError):
    pass


def fingerprint(shape):
    buffer = io.BytesIO()
    BRepTools.Write_s(shape.wrapped, buffer, False, False, TopTools_FormatVersion_VERSION_1)
    return hashlib.sha256(buffer.getvalue()).hexdigest()


def resolve(parts, reference):
    """Return a current face and serializable evidence; point/axis in CAD mm frame.

    `point` lies on the axis within this cylindrical face's axial extent.
    `axis` is the authored direction, not an orientation inferred from a face.
    Native worker occurrence shapes already include their instance transforms.
    """
    if not isinstance(reference, dict) or set(reference) - {'id', 'part', 'kind', 'point', 'axis', 'radius', 'toleranceMm'}:
        raise ReferenceError('Unsupported reference fields')
    kind = reference.get('kind')
    if kind not in ('cylinder', 'plane') or not isinstance(reference.get('id'), str) or not reference['id']:
        raise ReferenceError('Expected named cylinder or plane reference')
    if kind == 'plane' and 'radius' in reference:
        raise ReferenceError('Plane references do not have a radius')
    def vector(key):
        v = reference.get(key)
        if not isinstance(v, list) or len(v) != 3 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in v):
            raise ReferenceError('Expected finite 3-vector: ' + key)
        return v
    point, axis = vector('point'), vector('axis')
    norm = math.sqrt(sum(x*x for x in axis))
    if norm < 1e-12:
        raise ReferenceError('Axis cannot be zero')
    axis = [x/norm for x in axis]
    radius, tolerance = reference.get('radius'), reference.get('toleranceMm', 1e-5)
    for value in ((radius, tolerance) if kind == 'cylinder' else (tolerance,)):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ReferenceError('Radius and tolerance must be positive finite numbers')
    if tolerance > 0.01:
        raise ReferenceError('Reference tolerance exceeds 0.01 mm; revise the explicit datum instead')
    selected = [p for p in parts if p['id'] == reference.get('part')]
    if len(selected) != 1:
        raise ReferenceError('Missing or duplicate occurrence: ' + str(reference.get('part')))
    shape = selected[0]['shape']
    candidates = []
    for face in shape.Faces():
        surface = BRepAdaptor_Surface(face.wrapped)
        if kind == 'plane':
            if surface.GetType() == GeomAbs_Plane:
                normal = face.normalAt().toTuple()
                # Planar anchors identify the exact face centroid and outward
                # normal, not any coplanar face or nearest boundary.
                if math.dist(point, face.Center().toTuple()) <= tolerance and 1-sum(a*b for a,b in zip(axis,normal)) <= 1e-10:
                    candidates.append(face)
            continue
        if surface.GetType() != GeomAbs_Cylinder:
            continue
        cylinder = surface.Cylinder()
        direction = cylinder.Axis().Direction().Coord()
        if 1-abs(sum(a*b for a,b in zip(axis,direction))) > 1e-10 or abs(cylinder.Radius()-radius) > tolerance:
            continue
        delta = [a-b for a,b in zip(point,cylinder.Location().Coord())]
        along = sum(a*b for a,b in zip(delta,direction))
        distance = math.sqrt(sum((a-along*b)**2 for a,b in zip(delta,direction)))
        if distance <= tolerance and surface.FirstVParameter()-tolerance <= along <= surface.LastVParameter()+tolerance:
            candidates.append(face)
    if len(candidates) != 1:
        raise ReferenceError(f"Reference {reference['id']}: {'missing' if not candidates else 'ambiguous'} ({len(candidates)} matching faces)")
    evidence = dict(id=reference['id'], part=reference['part'], kind=kind, point=point,
                    axis=axis, shapeHash=fingerprint(shape), matches=1)
    if kind == 'cylinder': evidence['radius'] = radius
    return candidates[0], evidence


def inspect_references(parts, references):
    if not isinstance(references, list) or len(references) > 512:
        raise ReferenceError('Expected at most 512 references')
    if any(not isinstance(r, dict) for r in references):
        raise ReferenceError('References must be objects')
    names = [r.get('id') for r in references]
    if any(not isinstance(n, str) or not n for n in names) or len(set(names)) != len(names):
        raise ReferenceError('Duplicate or invalid reference IDs')
    result = []
    for ref in references:
        try:
            _, evidence = resolve(parts, ref)
            result.append(dict(ok=True, **evidence))
        except ReferenceError as e:
            result.append(dict(ok=False, id=ref['id'], error=str(e)))
    return dict(ok=all(r['ok'] for r in result), references=result, automaticRemapping=False)
