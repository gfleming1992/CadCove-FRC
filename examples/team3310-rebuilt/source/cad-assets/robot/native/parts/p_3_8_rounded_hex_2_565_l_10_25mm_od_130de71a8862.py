"""3-8-rounded-hex-2-565-l-10-25mm-od-130de71a8862: native CadQuery profile; dimensions are mm.
Ported from the reviewed authored profile; no STEP fallback.
"""
import json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'3-8-rounded-hex-2-565-l-10-25mm-od-130de71a8862.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    return build_prismatic_part(data["profile"], **p)
def build(ctx):
    return [{'id':'3-8-rounded-hex-2-565-l-10-25mm-od-130de71a8862','name':'3-8-rounded-hex-2-565-l-10-25mm-od-130de71a8862','color':'#aab3bd','shape':make()}]
