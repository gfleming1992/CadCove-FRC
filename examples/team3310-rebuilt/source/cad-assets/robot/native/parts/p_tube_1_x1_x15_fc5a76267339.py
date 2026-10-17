"""tube-1-x1-x15-fc5a76267339: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'tube-1-x1-x15-fc5a76267339.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'tube-1-x1-x15-fc5a76267339','name':'tube-1-x1-x15-fc5a76267339','color':'#aab3bd','shape':make()}]
