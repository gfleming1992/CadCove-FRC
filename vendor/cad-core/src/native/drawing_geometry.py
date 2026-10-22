"""Prepare an exact, source-pinned single-part TechDraw job (millimetres)."""
import hashlib
import json
import math
from pathlib import Path
from cad_references import fingerprint

VIEWS = ('top', 'front', 'right', 'isometric')

def number(value):
    return type(value) in (int, float) and math.isfinite(value)

def vector(value, size=3):
    return isinstance(value, list) and len(value) == size and all(number(x) for x in value)

def validate(request):
    if not isinstance(request, dict) or set(request) - {'schema','part','shapeHash','title','scale','dimensions','notes'}:
        raise ValueError('Unsupported drawing request fields')
    if request.get('schema') != 1 or not isinstance(request.get('part'), str) or not request['part']:
        raise ValueError('Drawing requires schema 1 and a part occurrence ID')
    title=request.get('title',request['part'])
    if not isinstance(title,str) or not 1 <= len(title) <= 64 or any(ord(c)<32 for c in title):
        raise ValueError('Drawing title must be 1 to 64 printable characters')
    scale=request.get('scale','fit')
    if scale != 'fit' and (not number(scale) or not 0.01 <= scale <= 10):
        raise ValueError('Scale must be fit or a number from 0.01 to 10')
    notes=request.get('notes',[])
    if not isinstance(notes,list) or len(notes)>2 or any(not isinstance(x,str) or len(x)>100 or any(ord(c)<32 for c in x) for x in notes):
        raise ValueError('Provide at most two notes of 100 printable characters')
    dimensions=request.get('dimensions',[])
    if not isinstance(dimensions,list) or len(dimensions)>12:
        raise ValueError('Provide at most 12 dimensions')
    names=set()
    for dim in dimensions:
        if not isinstance(dim,dict) or set(dim)-{'id','view','type','points','center','radiusMm','positionMm'}:
            raise ValueError('Unsupported dimension fields')
        if not isinstance(dim.get('id'),str) or not dim['id'] or dim['id'] in names:
            raise ValueError('Dimension IDs must be unique nonempty strings')
        names.add(dim['id'])
        if dim.get('view') not in VIEWS[:3] or dim.get('type') not in ('horizontal','vertical','distance','diameter'):
            raise ValueError('Dimension requires an orthographic view and supported type')
        if not vector(dim.get('positionMm'),2) or not (15 <= dim['positionMm'][0] <= 282 and 38 <= dim['positionMm'][1] <= 190):
            raise ValueError('Dimension positionMm must be inside the drawing area (page origin lower left)')
        if dim['type']=='diameter':
            if 'points' in dim or not vector(dim.get('center')) or not number(dim.get('radiusMm')) or dim['radiusMm']<=0:
                raise ValueError('Diameter requires center and positive radiusMm')
        elif 'center' in dim or 'radiusMm' in dim or not isinstance(dim.get('points'),list) or len(dim['points'])!=2 or not all(vector(x) for x in dim['points']) or math.dist(*dim['points'])<1e-6:
            raise ValueError('Linear dimension requires two distinct CAD vertex points')
    return request


def export_drawing(parts, request, output):
    validate(request)
    found=[p for p in parts if p['id']==request['part']]
    if len(found)!=1: raise ValueError('Missing or duplicate drawing occurrence: '+request['part'])
    shape=found[0]['shape']
    if not shape.isValid() or len(shape.Solids())!=1: raise ValueError('Drawing requires one valid solid')
    digest=fingerprint(shape)
    if 'shapeHash' in request and request['shapeHash']!=digest: raise ValueError('Stale drawing geometry hash')
    # Bind coordinates to geometry now; FreeCAD independently resolves them after BREP import.
    for dim in request.get('dimensions',[]):
        if dim['type']!='diameter':
            for point in dim['points']:
                if not any(math.dist(point,v.Center().toTuple())<1e-5 for v in shape.Vertices()):
                    raise ValueError('Dimension '+dim['id']+' references a missing CAD vertex')
        else:
            if not any(e.geomType()=='CIRCLE' and abs(e.radius()-dim['radiusMm'])<1e-5 and math.dist(e.arcCenter().toTuple(),dim['center'])<1e-5 for e in shape.Edges()):
                raise ValueError('Dimension '+dim['id']+' references a missing circular edge')
    root=Path(output);root.mkdir(parents=True,exist_ok=False)
    brep=root/'geometry.brep';shape.exportBrep(str(brep))
    job=dict(schema=1,request=request,shapeHash=digest,geometrySha256=hashlib.sha256(brep.read_bytes()).hexdigest())
    (root/'input.json').write_text(json.dumps(job,indent=2,allow_nan=False))
    return dict(ok=True,shapeHash=digest,output=str(root))
