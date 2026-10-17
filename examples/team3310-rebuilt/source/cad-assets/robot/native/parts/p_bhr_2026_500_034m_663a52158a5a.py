"""bhr-2026-500-034m-663a52158a5a: native CadQuery selected rounds and bores, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-034m-663a52158a5a.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    from native.parts.p_bhr_2026_500_034_cdf7d621b44d import make
    return make(**overrides).mirror((0,1,0),(0,-175.0856036,0))
def build(ctx):
    return [{'id':'bhr-2026-500-034m-663a52158a5a','name':'bhr-2026-500-034m-663a52158a5a','color':'#aab3bd','shape':make()}]
