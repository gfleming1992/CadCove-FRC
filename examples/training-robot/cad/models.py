"""Editable teaching geometry. Dimensions in design.json are metres."""
import json
from pathlib import Path
import cadquery as cq

def build_parts(parts):
    result = []
    for part in parts:
        p = [x * 1000 for x in part['position']]
        if part.get('kind') == 'wheel':
            width = part['width'] * 1000
            shape = cq.Solid.makeCylinder(part['radius'] * 1000, width,
                cq.Vector(p[0], p[1] - width / 2, p[2]), cq.Vector(0, 1, 0))
        else:
            shape = cq.Workplane('XY').box(*[v * 1000 for v in part['size']]).translate(p).val()
        result.append(dict(id=part['id'], name=part['id'], color=part['color'], shape=shape))
    return result

def build(ctx):
    return build_parts(json.loads(Path(__file__).with_name('design.json').read_text())['robotParts'])
