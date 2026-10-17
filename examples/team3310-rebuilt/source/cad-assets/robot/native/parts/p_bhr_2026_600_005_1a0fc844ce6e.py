"""bhr-2026-600-005-1a0fc844ce6e: native CadQuery manufacturing operations, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-600-005-1a0fc844ce6e.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    scale=p['boreRadiusScale']
    tools=[cq.Solid.makeCylinder(h['radius']*scale,h['length']+.00002,(h['at'][0],h['at'][1]-.00001,h['at'][2]),(0,1,0)) for h in data['bores']]
    tools += [cq.Solid.makeCone(h['r1']*scale,h['r2']*scale,h['length'],h['at'],(0,1,0)) for h in data['transitions']]
    return build_prismatic_part(data['profile']).cut(fuse(tools))
def build(ctx):
    return [{'id':'bhr-2026-600-005-1a0fc844ce6e','name':'bhr-2026-600-005-1a0fc844ce6e','color':'#aab3bd','shape':make()}]
