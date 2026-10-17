"""front-rail-3d6ef15b73d2: native CadQuery walls; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'front-rail-3d6ef15b73d2.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return fuse([build_prismatic_part(w, depth=w["depth"]*p["wallScale"]) for w in data["walls"]])
def build(ctx):
    return [{'id':'front-rail-3d6ef15b73d2','name':'front-rail-3d6ef15b73d2','color':'#aab3bd','shape':make()}]
