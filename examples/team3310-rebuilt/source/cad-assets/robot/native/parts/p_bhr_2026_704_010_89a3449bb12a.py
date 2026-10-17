"""bhr-2026-704-010-89a3449bb12a: native CadQuery manufacturing operations, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-704-010-89a3449bb12a.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    rotate=lambda q,a:[q[0]*math.cos(a)-q[1]*math.sin(a),q[0]*math.sin(a)+q[1]*math.cos(a)]
    outline=[]
    for i in range(26):
        for e in data['toothProfile']['outline']:
            outline.append({k:rotate(v,i*2*math.pi/26) if k in ('from','mid','to') else v for k,v in e.items()})
    stock=fuse([build_prismatic_part(dict(data['toothProfile'],outline=outline))]+[cq.Solid.makeCylinder(h['r'],h['length'],h['at']) for h in data['rings']]+[cq.Solid.makeCone(h['r1'],h['r2'],h['length'],h['at']) for h in data['cones']])
    segs=data['splineSegments'];pitch=2*math.pi/15;start=segs[0][0];end=segs[-1][3];radius=math.hypot(*end);edges=[]
    point=lambda q:cq.Vector(q[0]*p['boreScale'],q[1]*p['boreScale'],-7.15011)
    for i in range(15):
        a=i*pitch
        edges.extend(cq.Edge.makeBezier([point(rotate(q,a)) for q in seg]) for seg in segs)
        edges.append(cq.Edge.makeThreePointArc(point(rotate(end,a)),point([radius*math.cos(a+pitch/2),radius*math.sin(a+pitch/2)]),point(rotate(start,a+pitch))))
    bore=cq.Solid.extrudeLinear(cq.Wire.assembleEdges(edges),[],(0,0,14.30022))
    return stock.cut(bore)
def build(ctx):
    return [{'id':'bhr-2026-704-010-89a3449bb12a','name':'bhr-2026-704-010-89a3449bb12a','color':'#aab3bd','shape':make()}]
