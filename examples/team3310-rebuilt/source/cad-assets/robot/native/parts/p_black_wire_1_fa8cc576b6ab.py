"""black-wire-1-fa8cc576b6ab: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'black-wire-1-fa8cc576b6ab.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'black-wire-1-fa8cc576b6ab','name':'black-wire-1-fa8cc576b6ab','color':'#aab3bd','shape':make()}]
