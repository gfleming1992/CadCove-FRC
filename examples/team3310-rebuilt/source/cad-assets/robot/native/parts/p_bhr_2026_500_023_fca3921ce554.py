"""bhr-2026-500-023-fca3921ce554: native CadQuery selected rounds and bores, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-023-fca3921ce554.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    s=build_prismatic_part(data['profile']);bounds=s.BoundingBox()
    es=[e for e in s.Edges() if e.BoundingBox().xlen<1e-5 and e.BoundingBox().zlen<1e-5 and (abs(e.BoundingBox().xmin-bounds.xmin)<1e-5 or abs(e.BoundingBox().xmin-bounds.xmax)<1e-5)]
    s=s.fillet(p['earRadius'],es)
    s=s.fillet(p['edgeRadius'],sharp_edges(s))
    tools=[cq.Solid.makeCylinder(h['radius']*p['holeScale'],h['length']+.00002,[v-.00001*h['axis'][i] for i,v in enumerate(h['at'])],h['axis']) for h in data['holes']]
    return s.cut(fuse(tools))
def build(ctx):
    return [{'id':'bhr-2026-500-023-fca3921ce554','name':'bhr-2026-500-023-fca3921ce554','color':'#aab3bd','shape':make()}]
