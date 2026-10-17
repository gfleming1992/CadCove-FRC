"""bhr-2026-501-002-154ce885e9c6: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-501-002-154ce885e9c6.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'bhr-2026-501-002-154ce885e9c6','name':'bhr-2026-501-002-154ce885e9c6','color':'#aab3bd','shape':make()}]
