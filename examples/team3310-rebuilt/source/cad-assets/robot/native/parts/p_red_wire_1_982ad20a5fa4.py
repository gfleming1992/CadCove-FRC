"""red-wire-1-982ad20a5fa4: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'red-wire-1-982ad20a5fa4.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'red-wire-1-982ad20a5fa4','name':'red-wire-1-982ad20a5fa4','color':'#aab3bd','shape':make()}]
