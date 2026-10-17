"""bhr-2026-500-021-fa82999a309d: native CadQuery selected rounds and bores, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-021-fa82999a309d.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    profile=data['profile'];s=build_prismatic_part(dict(profile,cutouts=[]))
    s=s.fillet(1.5875,[e for e in s.Edges() if e.BoundingBox().zlen<1e-5])
    x=-346.9005;y0=-194.2734896701;y1=-152.7227175298;z=421.8432;r=1.5875
    s=fuse([s,cq.Workplane('XY').box(2*r,y1-y0,6.35).val().translate((x,(y0+y1)/2,z+3.175)),cq.Solid.makeCylinder(r,6.35,(x,y0,z)),cq.Solid.makeCylinder(r,6.35,(x,y1,z)),cq.Solid.makeCylinder(r,y1-y0,(x,y0,z),(0,1,0)),cq.Solid.makeSphere(r,(x,y0,z),angleDegrees1=-90),cq.Solid.makeSphere(r,(x,y1,z),angleDegrees1=-90)])
    for outline in profile['cutouts']: s=s.cut(build_prismatic_part(dict(profile,origin=[0,0,426],depth=8,outline=outline,cutouts=[])))
    for x,y in data['bores']:
        s=s.cut(cq.Solid.makeCylinder(2.2479*p['holeScale'],8,(x,y,426))).cut(cq.Solid.makeCylinder(3.96875*p['holeScale'],5,(x,y,428.7901)))
    es=[e for e in s.Edges() if e.BoundingBox().zlen<1e-5 and abs(e.BoundingBox().zmax-432.9557)<1e-5 and any(abs((e.BoundingBox().xmin+e.BoundingBox().xmax)/2-x)<.01 and abs((e.BoundingBox().ymin+e.BoundingBox().ymax)/2-y)<.01 for x,y in data['bores'])]
    return s.fillet(.508,es)
def build(ctx):
    return [{'id':'bhr-2026-500-021-fa82999a309d','name':'bhr-2026-500-021-fa82999a309d','color':'#aab3bd','shape':make()}]
