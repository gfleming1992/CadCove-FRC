"""bhr-2026-704-005-8e25fe6858d9: native CadQuery pockets; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-704-005-8e25fe6858d9.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    s = build_prismatic_part(data["stock"], **p)
    cutters = [build_prismatic_part(v) for v in data["pockets"]]
    return s.cut(fuse(cutters)) if cutters else s
def build(ctx):
    return [{'id':'bhr-2026-704-005-8e25fe6858d9','name':'bhr-2026-704-005-8e25fe6858d9','color':'#aab3bd','shape':make()}]
