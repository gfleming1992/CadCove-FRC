"""part-58-7efccbf29789: native CadQuery manufacturing operations, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'part-58-7efccbf29789.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    horizontal=lambda s:[e for e in s.Edges() if e.BoundingBox().zlen<1e-5]
    lower=build_prismatic_part(data['baseProfile']);lower=lower.fillet(.5,horizontal(lower))
    upper=build_prismatic_part(dict(data['padProfile'],origin=[0,0,97.925],depth=p['padRise']+.5))
    upper=upper.fillet(.5,[e for e in horizontal(upper) if abs(e.BoundingBox().zmin-98.425-p['padRise'])<1e-5])
    shape=lower.fuse(upper).clean()
    holes=[cq.Solid.makeCylinder(2.2479*p['holeScale'],data['baseProfile']['depth']+p['padRise']+.00002,(-285.75,y,data['baseProfile']['origin'][2]-.00001)) for y in [-183.0231036,-163.9731036]]
    return shape.cut(fuse(holes))
def build(ctx):
    return [{'id':'part-58-7efccbf29789','name':'part-58-7efccbf29789','color':'#aab3bd','shape':make()}]
