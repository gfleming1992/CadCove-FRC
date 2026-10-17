"""origin-cube-c4333aff6108: native CadQuery cube; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'origin-cube-c4333aff6108.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    size=p["size"]
    return cq.Workplane("XY").box(size,size,size).val().translate((0,0,-size/2))
def build(ctx):
    return [{'id':'origin-cube-c4333aff6108','name':'origin-cube-c4333aff6108','color':'#aab3bd','shape':make()}]
