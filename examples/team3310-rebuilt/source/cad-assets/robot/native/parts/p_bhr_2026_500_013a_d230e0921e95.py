"""bhr-2026-500-013a-d230e0921e95: native CadQuery detailed manufactured features."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-013a-d230e0921e95.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    floor=155.575;top=165.1
    pocket=lambda outline:dict(origin=[0,0,floor],normal=[0,0,1],u=[1,0,0],v=[0,1,0],direction=[0,0,1],depth=top-floor+.00001,outline=outline,cutouts=[])
    at=lambda shape,z:[e for e in shape.Edges() if abs(e.BoundingBox().zmin-z)<1e-5 and abs(e.BoundingBox().zmax-z)<1e-5]
    shape=build_prismatic_part(data['stockProfile'])
    for contour in data['reliefContours']:
        cutter=build_prismatic_part(pocket(contour));cutter=cutter.fillet(1.5875,at(cutter,floor));shape=shape.cut(cutter)
    for c in data['nutCenters']:
        r=p['nutAcrossFlats']/math.sqrt(3);pts=[[c[0]+r*math.cos(i*math.pi/3),c[1]+r*math.sin(i*math.pi/3)] for i in range(6)]
        shape=shape.cut(build_prismatic_part(pocket([dict(kind='line',**{'from':pt,'to':pts[(i+1)%6]}) for i,pt in enumerate(pts)])))
    y0=data['stockProfile']['origin'][1];y1=y0+data['stockProfile']['depth']
    shape=shape.fillet(1.016,[e for e in at(shape,top) if e.BoundingBox().ymin>y0+1e-4 and e.BoundingBox().ymax<y1-1e-4])
    return shape.cut(fuse([cq.Solid.makeCylinder(h['radius']*p['holeScale'],h['length']+.00002,[v-h['axis'][i]*.00001 for i,v in enumerate(h['at'])],h['axis']) for h in data['screwHoles']]))
def build(ctx):
    return [{'id':'bhr-2026-500-013a-d230e0921e95','color':'#aab3bd','shape':make()}]
