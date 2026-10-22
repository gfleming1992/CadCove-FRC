"""Full-size flat stock profiles using CadQuery's existing DXF exporter."""
import hashlib
import json
import math
from pathlib import Path
import cadquery as cq
from cadquery.occ_impl.exporters.dxf import DxfDocument
from cad_references import fingerprint
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

def exact_bounds(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape.wrapped, box, False, False)
    return box.Get()



def vector(value):
    return isinstance(value, list) and len(value) == 3 and all(type(v) in (int, float) and math.isfinite(v) for v in value)


def prepare(parts, request):
    if not isinstance(request, dict) or set(request) - {'schema', 'part', 'shapeHash', 'frame'}:
        raise ValueError('Unsupported flat export fields')
    if type(request.get('schema')) is not int or request['schema'] != 1 or not isinstance(request.get('part'), str) or not request['part']:
        raise ValueError('Flat export requires schema 1 and a part occurrence ID')
    frame = request.get('frame')
    if not isinstance(frame, dict) or set(frame) != {'origin', 'xDir', 'normal'} or not all(vector(v) for v in frame.values()):
        raise ValueError('frame requires finite origin, xDir and normal vectors')
    x, n = cq.Vector(frame['xDir']), cq.Vector(frame['normal'])
    if x.Length < 1e-9 or n.Length < 1e-9 or abs(x.normalized().dot(n.normalized())) > 1e-8:
        raise ValueError('Frame directions must be nonzero and perpendicular')
    found = [p for p in parts if p['id'] == request['part']]
    if len(found) != 1:
        raise ValueError('Missing or duplicate flat export occurrence: ' + request['part'])
    shape = found[0]['shape']
    if not shape.isValid() or len(shape.Solids()) != 1:
        raise ValueError('Flat export requires one valid solid')
    digest = fingerprint(shape)
    if 'shapeHash' in request and request['shapeHash'] != digest:
        raise ValueError('Stale flat export geometry hash')
    plane = cq.Plane(frame['origin'], frame['xDir'], frame['normal'])
    local = shape.transformShape(plane.fG)
    xmin, ymin, zmin, xmax, ymax, zmax = exact_bounds(local)
    if abs(zmin) > 1e-5 or zmax <= 1e-5:
        raise ValueError('Frame must lie on the stock bottom face, with normal pointing into the solid')
    faces = [f for f in local.Faces() if f.geomType() == 'PLANE' and abs(exact_bounds(f)[2]) < 1e-5 and abs(exact_bounds(f)[5]) < 1e-5]
    if len(faces) != 1:
        raise ValueError('Expected one planar stock face at the frame origin plane')
    face = faces[0].translate((0, 0, -faces[0].Center().z))
    wires = [face.outerWire(), *face.innerWires()]
    if not face.isValid() or any(not w.IsClosed() or not w.isValid() for w in wires):
        raise ValueError('Profile must have valid closed contours')
    thickness = zmax
    reconstructed = cq.Solid.extrudeLinear(wires[0], wires[1:], (0, 0, thickness))
    missing = local.cut(reconstructed).Volume()
    extra = reconstructed.cut(local).Volume()
    tolerance = max(1e-5, local.Volume() * 1e-8)
    if missing > tolerance or extra > tolerance:
        raise ValueError('Part is not a constant-section flat extrusion; pockets, countersinks, bevels and bent parts need a different export')
    return face, wires, dict(shapeHash=digest, thicknessMm=thickness, areaMm2=face.Area(),
        boundsMm=dict(min=[xmin, ymin], max=[xmax, ymax]),
        contourCount=len(wires), holeCount=len(wires)-1,
        validation=dict(missingVolumeMm3=missing, extraVolumeMm3=extra, volumeToleranceMm3=tolerance))


def export_flat(parts, request, output):
    face, wires, evidence = prepare(parts, request)
    root = Path(output)
    # Validate first: a failed profile request must not create an export directory.
    root.mkdir(parents=True, exist_ok=False)
    dxf = DxfDocument(doc_units=4)
    dxf.add_layer('OUTLINE').add_layer('HOLES')
    dxf.add_shape(wires[0], layer='OUTLINE')
    for wire in wires[1:]:
        dxf.add_shape(wire, layer='HOLES')
    dxf.document.saveas(str(root/'profile.dxf'))
    from dxf_preview import render_dxf
    preview = render_dxf(root/'profile.dxf', root/'profile.svg')
    files = {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ('profile.dxf', 'profile.svg')}
    result = dict(ok=True, schema=1, part=request['part'], units='mm', scale=1, frame=request['frame'],
        **evidence, preview=preview, files=files, reviewRequired=True,
        limitations=['No cutter compensation, toolpaths or machining settings',
                     'SVG is a display preview generated from DXF; use the DXF for CAM import'])
    (root/'result.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    return result
