"""bhr-2026-500-033-178be009fceb: native CadQuery detailed manufactured features."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse, sharp_edges
data=json.loads((Path(__file__).parents[1]/'data'/'bhr-2026-500-033-178be009fceb.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    shape=build_prismatic_part(data['profile'])
    limiter=fuse([cq.Workplane('XY').box(19.05,100,50.8).val().translate((-348.488,-173.4981036,(168.275+219.075)/2))]+[cq.Solid.makeCylinder(9.525,100,(-348.488,-220,z),(0,1,0)) for z in [168.275,219.075]])
    shape=shape.intersect(limiter);shape=shape.fillet(1.5875,sharp_edges(shape))
    for y,z,r in [[-160.7981036,168.275,2.0955],[-157.6231036,219.075,1.7272],[-195.7231036,219.075,2.2479],[-192.5481036,168.275,2.5527]]:shape=shape.cut(cq.Solid.makeCylinder(r*p['holeScale'],6.35002,(-348.488,y-.00001,z),(0,1,0)))
    wires=[]
    for sec in data['sections']:
        x=sec['x'];points=[(x,y,z) for y,z in sec['profile']];c=points[0];d=points[-1];r=math.hypot(d[1]+189.3731036,d[2]-190.5);angle=math.atan2(d[2]-190.5,d[1]+189.3731036)
        e=(x,-189.3731036-r,190.5);mid=(x,-189.3731036+r*math.cos((angle-math.pi)/2),190.5+r*math.sin((angle-math.pi)/2));a=(x,-198,168.275);bottom=(x,c[1],168.275);f=(x,-198,190.5)
        wires.append(cq.Wire.assembleEdges([cq.Edge.makeLine(a,bottom),cq.Edge.makeLine(bottom,c),cq.Edge.makeSpline([cq.Vector(*v) for v in points]),cq.Edge.makeThreePointArc(d,mid,e),cq.Edge.makeLine(e,f),cq.Edge.makeLine(f,a)]))
    cutter=cq.Solid.makeLoft(wires, ruled=True)
    for sx in [1,-1]:
        for sy in [1,-1]:
            tool=cutter
            if sx<0:tool=tool.mirror((1,0,0),(-348.488,0,0))
            if sy<0:tool=tool.mirror((0,1,0),(0,-173.4981036,0))
            shape=shape.cut(tool)
    return shape
def build(ctx):
    return [{'id':'bhr-2026-500-033-178be009fceb','color':'#aab3bd','shape':make()}]
