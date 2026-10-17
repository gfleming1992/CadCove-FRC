"""belly-pan-6b59cb2988d9: native CadQuery manufacturing operations, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'belly-pan-6b59cb2988d9.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    profile=deepcopy(data['profile'])
    # Circular mounting patterns scale; recovered lightening contours stay fixed.
    for loop in profile['cutouts']:
        for e in loop:
            if e['kind']=='circle': e['radius']*=p['holeScale']
    return build_prismatic_part(profile,depth=p['depth'])
def build(ctx):
    return [{'id':'belly-pan-6b59cb2988d9','name':'belly-pan-6b59cb2988d9','color':'#aab3bd','shape':make()}]
