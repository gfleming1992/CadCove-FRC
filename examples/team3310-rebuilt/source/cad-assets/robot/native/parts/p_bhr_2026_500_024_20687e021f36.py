"""bhr-2026-500-024-20687e021f36: native CadQuery profiles; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-024-20687e021f36.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return fuse([build_prismatic_part(v, holeScale=p["holeScale"]) for v in data["profiles"]])
def build(ctx):
    return [{'id':'bhr-2026-500-024-20687e021f36','name':'bhr-2026-500-024-20687e021f36','color':'#aab3bd','shape':make()}]
