"""bhr-2026-704-011-39792b4ea64a: native CadQuery manufacturing operations, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-704-011-39792b4ea64a.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    center=[222.50400000000002,-1.2928325077155023e-11]
    hole=deepcopy(data['bore'])
    for e in hole['outline']:
        for k in ['from','to']: e[k]=[center[i]+(v-center[i])*p['boreScale'] for i,v in enumerate(e[k])]
    shapes=[build_prismatic_part(data['profile'])]
    shapes += [cq.Solid.makeCylinder(h['r'],h['length'],h['at']) for h in data['rings']]
    shapes += [cq.Solid.makeCone(h['r1'],h['r2'],h['length'],h['at']) for h in data['cones']]
    return fuse(shapes).cut(build_prismatic_part(hole))
def build(ctx):
    return [{'id':'bhr-2026-704-011-39792b4ea64a','name':'bhr-2026-704-011-39792b4ea64a','color':'#aab3bd','shape':make()}]
