"""bhr-2026-600-003-ea37fa06fae4: native CadQuery detailed manufactured features."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-600-003-ea37fa06fae4.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    profile=deepcopy(data['profile'])
    for loop in profile['cutouts']:
        for e in loop:
            if e['kind']=='circle' and e['radius']<5:e['radius']*=p['holeScale']
    shape=build_prismatic_part(profile);r=11.1506+1.5875
    lips=[cq.Solid.makeCylinder(r,5,(at[0],at[1],399.6182-1.5875)).cut(cq.Solid.makeTorus(r,1.5875,(at[0],at[1],399.6182-1.5875))) for at in data['notches']]
    shape=shape.cut(fuse(lips), tol=1e-6)
    drills=lambda points,r,length:fuse([cq.Solid.makeCylinder(r,length+.00002,(at[0],at[1],at[2]-.00001)) for at in points])
    envelope=cq.Solid.makeCylinder(146.05,6.35,data['center']).cut(drills([data['center']],130.9878,6.35))
    envelope=envelope.chamfer(1.5875,None,[e for e in envelope.Edges() if abs(e.BoundingBox().zmin-399.6182)<1e-5])
    return shape.intersect(envelope).cut(drills(data['notches'],12.7,1.778))
def build(ctx):
    return [{'id':'bhr-2026-600-003-ea37fa06fae4','color':'#aab3bd','shape':make()}]
