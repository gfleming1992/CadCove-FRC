"""bhr-2026-500-034-cdf7d621b44d: native CadQuery selected rounds and bores, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-034-cdf7d621b44d.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    profiles=data['profiles'];s=fuse([build_prismatic_part(v,holeScale=p['holeScale']) for v in profiles])
    back=profiles[0]['origin'][1];floor=profiles[1]['origin'][1];shoulder=profiles[2]['origin'][1]
    def selected(e):
        q=e.BoundingBox()
        return q.ylen<1e-5 and abs(q.ymin-shoulder)>=1e-5 and not(abs(q.ymin-back)<1e-5 and e.geomType()=='CIRCLE' and e.IsClosed()) and not(abs(q.ymin-floor)<1e-5 and q.zmin>332)
    return s.fillet(p['edgeRadius'],[e for e in s.Edges() if selected(e)])
def build(ctx):
    return [{'id':'bhr-2026-500-034-cdf7d621b44d','name':'bhr-2026-500-034-cdf7d621b44d','color':'#aab3bd','shape':make()}]
