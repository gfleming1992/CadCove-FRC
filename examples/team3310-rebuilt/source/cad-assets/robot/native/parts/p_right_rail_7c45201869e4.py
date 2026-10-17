"""right-rail-7c45201869e4: native CadQuery walls; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'right-rail-7c45201869e4.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return fuse([build_prismatic_part(w, depth=w["depth"]*p["wallScale"]) for w in data["walls"]])
def build(ctx):
    return [{'id':'right-rail-7c45201869e4','name':'right-rail-7c45201869e4','color':'#aab3bd','shape':make()}]
