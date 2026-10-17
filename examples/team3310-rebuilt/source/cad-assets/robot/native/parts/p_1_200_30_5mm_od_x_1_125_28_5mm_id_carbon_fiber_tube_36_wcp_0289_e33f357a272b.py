"""1-200-30-5mm-od-x-1-125-28-5mm-id-carbon-fiber-tube-36-wcp-0289-e33f357a272b: native CadQuery pockets; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'1-200-30-5mm-od-x-1-125-28-5mm-id-carbon-fiber-tube-36-wcp-0289-e33f357a272b.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    s = build_prismatic_part(data["stock"], **p)
    cutters = [build_prismatic_part(v) for v in data["pockets"]]
    return s.cut(fuse(cutters)) if cutters else s
def build(ctx):
    return [{'id':'1-200-30-5mm-od-x-1-125-28-5mm-id-carbon-fiber-tube-36-wcp-0289-e33f357a272b','name':'1-200-30-5mm-od-x-1-125-28-5mm-id-carbon-fiber-tube-36-wcp-0289-e33f357a272b','color':'#aab3bd','shape':make()}]
