"""bhr-2026-600-009-55277c8c2a54: native CadQuery selected rounds and bores, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-600-009-55277c8c2a54.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    s=build_prismatic_part(data['profile']).intersect(cq.Solid.makeCylinder(127.7874,100,(-162.5586951227,-173.4981036,412.9057)))
    s=s.fillet(3.175,[e for e in sharp_edges(s) if e.BoundingBox().xlen<1e-5 and e.BoundingBox().ylen<1e-5])
    s=s.fillet(.79375,[e for e in sharp_edges(s) if e.BoundingBox().zmax>413.90571])
    for h in data['holes']: s=s.cut(cq.Solid.makeCylinder(h['radius']*p['holeScale'],h['length']+.00002,[v-.00001*h['axis'][i] for i,v in enumerate(h['at'])],h['axis']))
    return s
def build(ctx):
    return [{'id':'bhr-2026-600-009-55277c8c2a54','name':'bhr-2026-600-009-55277c8c2a54','color':'#aab3bd','shape':make()}]
