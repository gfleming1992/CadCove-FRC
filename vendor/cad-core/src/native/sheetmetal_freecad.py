"""Headless adapter to an explicitly installed, unmodified FreeCAD SheetMetal add-on.
No FreeCADGui imports or GUI commands. Run with FreeCADCmd, isolated preferences.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import traceback


def execute(root):
    import FreeCAD as App
    import Part
    if App.GuiUp:
        raise ValueError('Use FreeCADCmd with the GUI disabled')
    addon = Path(os.environ['CADCOVE_SHEETMETAL']).resolve()
    sys.path.insert(0, str(addon))
    # Check the dependency before upstream's import, which gives an opaque NameError.
    import networkx as nx
    import SheetMetalNewUnfolder as sm
    job = json.loads((root/'input.json').read_text()); request = job['request']
    if hashlib.sha256((root/'input.brep').read_bytes()).hexdigest() != job['geometrySha256']:
        raise ValueError('Sheet metal input BREP hash mismatch')
    shape = Part.Shape(); shape.read(str(root/'input.brep'))
    if not shape.isValid() or len(shape.Solids) != 1:
        raise ValueError('Invalid sheet metal input solid')
    ref = request['rootFace']; normal = App.Vector(*ref['axis']); normal.normalize()
    point = App.Vector(*ref['point']); tolerance = ref.get('toleranceMm', 1e-5)
    matches = [i for i, f in enumerate(shape.Faces) if f.Surface.TypeId == 'Part::GeomPlane'
               and (f.CenterOfMass-point).Length <= tolerance and 1-f.normalAt(0, 0).dot(normal) <= 1e-10]
    if len(matches) != 1:
        raise ValueError('Root face missing or ambiguous after geometry handoff')
    index = matches[0]
    thickness = sm.EstimateThickness.using_best_method(shape, index)
    if not math.isfinite(thickness) or abs(thickness-request['thicknessMm']) > 1e-5:
        raise ValueError('Detected sheet thickness differs from explicit thicknessMm')
    graph = sm.build_graph_of_tangent_faces(shape, index)
    bend_specs = []
    for i in sorted(graph.nodes):
        f = shape.Faces[i]
        if f.Surface.TypeId != 'Part::GeomCylinder': continue
        up = sm.BendDirection.from_face(f) == sm.BendDirection.UP
        sweep = math.degrees(f.ParameterRange[1]-f.ParameterRange[0])
        bend_specs.append(dict(face='Face'+str(i+1), angleDeg=sweep*(1 if up else -1),
                               innerRadiusMm=f.Surface.Radius-(0 if up else thickness)))
    expected_bends = len(bend_specs)
    if not expected_bends:
        raise ValueError('No cylindrical bends found from root face; use cad-flat for flat stock')
    doc = App.newDocument('CadCoveSheetMetal')
    try:
        obj = doc.addObject('PartDesign::Feature', 'Bent'); obj.Shape = shape
        k = request['kFactor']; bac = sm.BendAllowanceCalculator.from_single_value(k['value'], k['standard'])
        base, flat, bends, normal, infos = sm.getUnfold(bac, obj, 'Face'+str(index+1))
        # Upstream can warn and skip an unrollable face. Never accept a partial result.
        if len(infos) != expected_bends:
            raise ValueError('Unfolder omitted bends; refusing a partial flat pattern')
        if not flat.isValid() or len(flat.Solids) != 1:
            raise ValueError('Unfolder returned invalid or disconnected flat geometry')
        matrix = sm.SketchExtraction.move_to_origin(flat, base)
        flat = flat.transformed(matrix); bends = bends.transformed(matrix)
        if abs(flat.BoundBox.ZMin) > 1e-5 or abs(flat.BoundBox.ZLength-thickness) > 1e-5:
            raise ValueError('Unfolder returned nonplanar stock')
        if bends.isNull() or bends.BoundBox.ZLength > 1e-5:
            raise ValueError('Bend marks are missing or not coplanar')
        # Centerlines lie on the stationary surface (top or bottom after alignment).
        # DXF is XY at Z=0, independent of which stock surface was the reference.
        bends.translate(App.Vector(0, 0, -bends.BoundBox.ZMin))
        flat.exportBrep(str(root/'flat.brep')); bends.exportBrep(str(root/'bends.brep'))
        # Store the actual loaded add-on Python source hashes, including dependencies
        # loaded from that directory, instead of claiming every install is the tested pin.
        sources = {}
        for module in list(sys.modules.values()):
            filename = getattr(module, '__file__', None)
            if filename:
                p = Path(filename).resolve()
                if p.is_relative_to(addon) and p.suffix == '.py':
                    sources[str(p.relative_to(addon))] = hashlib.sha256(p.read_bytes()).hexdigest()
        return dict(ok=True, backend='FreeCAD SheetMetal NewUnfolder', guiUp=App.GuiUp, freecad=App.Version(),
                    networkx=nx.__version__, addonSources=sources, thicknessMm=thickness,
                    bendCount=len(infos), bends=bend_specs, bendLineSegments=len(bends.Edges),
                    files={n: hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ('flat.brep', 'bends.brep')})
    finally: App.closeDocument(doc.Name)


if os.environ.get('CADCOVE_SHEETMETAL_JOB'):
    root = Path(os.environ['CADCOVE_SHEETMETAL_JOB']).resolve()
    try: result = execute(root)
    except Exception as error:
        traceback.print_exc(); result = dict(ok=False, error=str(error))
    with (root/'backend-result.json').open('x') as f: json.dump(result, f, indent=2, allow_nan=False)
    print(json.dumps(dict(ok=result['ok'], error=result.get('error')), allow_nan=False), flush=True)
