"""bhr-2024-130-001a-4dde5764e7c3: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2024-130-001a-4dde5764e7c3.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'bhr-2024-130-001a-4dde5764e7c3','name':'bhr-2024-130-001a-4dde5764e7c3','color':'#aab3bd','shape':make()}]
