"""bhr-2026-500-013b-10a3b616a4ed: native CadQuery detailed manufactured features."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-013b-10a3b616a4ed.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    from native.parts.p_bhr_2026_500_013a_d230e0921e95 import make as rail
    depth=p['engravingDepth']
    if not 0<depth<3.175:raise ValueError('Engraving exceeds floor')
    cutters=[build_prismatic_part(dict(origin=[0,0,-155.57501],normal=[0,0,1],u=[1,0,0],v=[0,1,0],direction=[0,0,1],depth=depth+.00001,**profile)) for profile in data['glyphProfiles']]
    return rail(holeScale=p['holeScale'],nutAcrossFlats=p['nutAcrossFlats']).mirror('XY').cut(fuse(cutters))
def build(ctx):
    return [{'id':'bhr-2026-500-013b-10a3b616a4ed','color':'#aab3bd','shape':make()}]
