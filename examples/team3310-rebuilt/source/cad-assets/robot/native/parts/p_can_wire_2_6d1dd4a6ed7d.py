"""can-wire-2-6d1dd4a6ed7d: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'can-wire-2-6d1dd4a6ed7d.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'can-wire-2-6d1dd4a6ed7d','name':'can-wire-2-6d1dd4a6ed7d','color':'#aab3bd','shape':make()}]
