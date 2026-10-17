"""1-2-rounded-hex-24-996-l-13-75mm-od-10c910583edd: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'1-2-rounded-hex-24-996-l-13-75mm-od-10c910583edd.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'1-2-rounded-hex-24-996-l-13-75mm-od-10c910583edd','name':'1-2-rounded-hex-24-996-l-13-75mm-od-10c910583edd','color':'#aab3bd','shape':make()}]
