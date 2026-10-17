"""back-rail-15991ee5f759: native CadQuery walls; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'back-rail-15991ee5f759.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return fuse([build_prismatic_part(w, depth=w["depth"]*p["wallScale"]) for w in data["walls"]])
def build(ctx):
    return [{'id':'back-rail-15991ee5f759','name':'back-rail-15991ee5f759','color':'#aab3bd','shape':make()}]
