"""bhr-2026-500-005-b5b879a8e88d: native CadQuery bearings; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-005-b5b879a8e88d.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    profiles = deepcopy(data["profiles"])
    for profile in profiles:
        for edge in profile["outline"]:
            if edge["kind"] == "circle": edge["radius"] *= p["bearingRadiusScale"]
    return fuse([build_prismatic_part(v) for v in profiles])
def build(ctx):
    return [{'id':'bhr-2026-500-005-b5b879a8e88d','name':'bhr-2026-500-005-b5b879a8e88d','color':'#aab3bd','shape':make()}]
