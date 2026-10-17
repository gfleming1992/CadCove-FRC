"""bhr-2026-500-006-3e1d72d87606: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-006-3e1d72d87606.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'bhr-2026-500-006-3e1d72d87606','name':'bhr-2026-500-006-3e1d72d87606','color':'#aab3bd','shape':make()}]
