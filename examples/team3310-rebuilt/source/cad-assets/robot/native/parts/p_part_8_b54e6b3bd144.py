"""part-8-b54e6b3bd144: native CadQuery manufacturing operations, millimetres."""
import math,json
from pathlib import Path
from copy import deepcopy
import cadquery as cq
from native.manufacturing import build_prismatic_part, fuse
data=json.loads((Path(__file__).parents[1]/'data'/'part-8-b54e6b3bd144.json').read_text())
parameters=data.get('parameters', {})
def make(**overrides):
    p={**parameters, **overrides}
    frame=data['stockFrame']; floor=p['pocketFloor']
    if not 0<floor<frame['depth']: raise ValueError('Invalid pocket floor')
    holes=[[dict(kind='circle',center=c,radius=g['diameter']*p['holeScale']/2)] for g in data['mountingHoles'] for c in g['centers']]
    stock=build_prismatic_part(dict(frame,outline=data['perimeter'],cutouts=data['throughSlots']+holes))
    recess=dict(data['recess'],origin=[v+frame['direction'][i]*floor for i,v in enumerate(frame['origin'])],depth=frame['depth']-floor+.00001)
    return stock.cut(build_prismatic_part(recess))
def build(ctx):
    return [{'id':'part-8-b54e6b3bd144','name':'part-8-b54e6b3bd144','color':'#aab3bd','shape':make()}]
