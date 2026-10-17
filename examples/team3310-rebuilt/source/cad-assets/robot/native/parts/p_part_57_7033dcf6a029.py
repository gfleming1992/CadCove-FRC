"""part-57-7033dcf6a029: native CadQuery manufacturing operations, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'part-57-7033dcf6a029.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    z0=101.6;cy=-173.4981036;height=p['height'];scale=p['holeScale']
    if height<20 or scale<=0: raise ValueError('Invalid height or holes')
    pts=[[-292.1,cy-19.05],[-279.4,cy-19.05],[-279.4,cy-9.525],[-282.575,cy-9.525],[-282.575,cy+9.525],[-279.4,cy+9.525],[-279.4,cy+19.05],[-292.1,cy+19.05]]
    outline=[dict(kind='line',**{'from':a,'to':pts[(i+1)%len(pts)]}) for i,a in enumerate(pts)]
    s=build_prismatic_part(dict(origin=[0,0,z0],normal=[0,0,1],u=[1,0,0],v=[0,1,0],direction=[0,0,1],depth=height,outline=outline,cutouts=[]))
    s=s.fillet(1,[e for e in s.Edges() if e.BoundingBox().zlen>height-.001])
    s=s.fillet(.5,[e for e in s.Edges() if abs(e.BoundingBox().zmin-z0-height)<1e-5 and abs(e.BoundingBox().zmax-z0-height)<1e-5])
    r=1.7272*scale;depth=15.875;tip=r/math.tan(math.radians(59))
    tools=[cq.Solid.makeCylinder(r,9.525+.00002,(-292.10001,cy,111.125),(1,0,0))]
    for y in [cy-9.525,cy+9.525]:
        tools.extend([cq.Solid.makeCylinder(r,depth+.00001,(-285.75,y,z0-.00001)),cq.Solid.makeCone(r,0,tip,(-285.75,y,z0+depth))])
    return s.cut(fuse(tools))
def build(ctx):
    return [{'id':'part-57-7033dcf6a029','name':'part-57-7033dcf6a029','color':'#aab3bd','shape':make()}]
