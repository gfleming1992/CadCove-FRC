"""can-wire-3-b5f8e7694f0f: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'can-wire-3-b5f8e7694f0f.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'can-wire-3-b5f8e7694f0f','name':'can-wire-3-b5f8e7694f0f','color':'#aab3bd','shape':make()}]
