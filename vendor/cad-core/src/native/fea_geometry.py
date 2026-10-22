"""Pin an explicit single-solid analysis to current native geometry.

Exports exact BREP plus checked boundary descriptors. FreeCAD independently
matches each descriptor after loading; face indices are never an interchange API.
"""
import hashlib
import copy
import json
import math
from pathlib import Path
from cad_references import resolve, fingerprint
from fea_request import prepare


def prepare_geometry(parts, request):
    """Attach current CAD evidence without inventing materials or conditions."""
    prepare(request)  # Validate the input before inspecting or changing it.
    request = copy.deepcopy(request)
    geometry = []
    for spec in request.get('parts', []):
        found = [p for p in parts if p['id'] == spec['id']]
        if len(found) != 1: raise ValueError('Missing or duplicate analysis occurrence: ' + spec['id'])
        shape = found[0]['shape']
        if not shape.isValid() or len(shape.Solids()) != 1 or shape.Volume() <= 0:
            raise ValueError('Analysis requires one valid solid: ' + spec['id'])
        current = fingerprint(shape)
        if 'shapeHash' in spec and spec['shapeHash'] != current:
            raise ValueError('Stale analysis geometry hash: ' + spec['id'])
        spec['shapeHash'] = current
        geometry.append(dict(id=spec['id'], shapeHash=current, volumeMm3=shape.Volume(), faces=len(shape.Faces())))
    review = prepare(request)
    review['geometry'] = geometry
    return review


def export_analysis(parts, request, output):
    if not isinstance(request, dict) or set(request) != {'analysis', 'references', 'mesh'}:
        raise ValueError('Expected analysis, references, and mesh')
    analysis = request['analysis']
    review = prepare(analysis)
    if not review['inputComplete']:
        raise ValueError('Analysis inputs incomplete: ' + json.dumps(review['questions']))
    mesh = request['mesh']
    if not isinstance(mesh, dict) or set(mesh) != {'sizesMm', 'relativeTolerance'}:
        raise ValueError('Mesh requires sizesMm and relativeTolerance')
    sizes = mesh['sizesMm']
    if not isinstance(sizes, list) or not 2 <= len(sizes) <= 4 or not all(type(x) in (int, float) and math.isfinite(x) and x > 0 for x in sizes) or any(a <= b for a,b in zip(sizes,sizes[1:])):
        raise ValueError('Provide two to four strictly decreasing positive mesh sizes')
    tol = mesh['relativeTolerance']
    if type(tol) not in (int,float) or not math.isfinite(tol) or not 0 < tol <= .2:
        raise ValueError('Relative convergence tolerance must be >0 and <=0.2')
    spec = analysis['parts'][0]
    found = [p for p in parts if p['id'] == spec['id']]
    if len(found) != 1: raise ValueError('Missing or duplicate analysis occurrence')
    shape = found[0]['shape']
    if not shape.isValid() or len(shape.Solids()) != 1 or shape.Volume() <= 0:
        raise ValueError('Analysis requires one valid solid')
    if fingerprint(shape) != spec['shapeHash']: raise ValueError('Stale analysis geometry hash')
    refs = request['references']
    if not isinstance(refs,list) or len(refs)>512: raise ValueError('Invalid references')
    checked = {}
    for ref in refs:
        if ref.get('part') != spec['id'] or ref.get('id') in checked:
            raise ValueError('Reference part mismatch or duplicate ID')
        face, evidence = resolve(parts, ref)
        checked[ref['id']] = dict(query=ref, evidence=evidence, areaMm2=face.Area(), centerMm=list(face.Center().toTuple()))
    for entry in analysis['supports'] + analysis['loads']:
        if entry['reference'] not in checked: raise ValueError('Missing boundary reference: '+entry['reference'])
    if any(s['restrainedTranslations'] != [True, True, True] for s in analysis['supports']):
        raise ValueError('This backend currently supports fully fixed faces only')
    if {s['reference'] for s in analysis['supports']} & {s['reference'] for s in analysis['loads']}:
        raise ValueError('Force and support cannot use the same face')
    root=Path(output);root.mkdir(parents=True,exist_ok=False)
    brep=root/'geometry.brep';shape.exportBrep(str(brep))
    result=dict(schema=1,analysis=analysis,references=checked,mesh=mesh,
                geometry=dict(file='geometry.brep',sha256=hashlib.sha256(brep.read_bytes()).hexdigest(),volumeMm3=shape.Volume(),faces=len(shape.Faces())))
    (root/'input.json').write_text(json.dumps(result,indent=2,allow_nan=False))
    return dict(ok=True,stage='geometry-validated',solved=False,output=str(root),shapeHash=spec['shapeHash'],references=list(checked))
