"""Rotary mechanism teaching fixture. Geometry dimensions come from geometry.json; motion stays in mechanism.json.
Spur teeth use sampled involutes; pulleys/sprockets are schematic profiles,
not vendor replacements or manufacturing-qualified tooth forms.
"""
import json, math
from pathlib import Path
import cadquery as cq
DATA=json.loads((Path(__file__).parent/'geometry.json').read_text())
def wheel(teeth, radius, thickness, kind):
    if kind=='gear':
        base=radius*math.cos(math.radians(20)); root=radius-2.5; outer=radius+2
        inv=lambda r: math.sqrt(max(0,(r/base)**2-1))-math.acos(min(1,base/r))
        half=math.pi/(2*teeth)+inv(radius)
        shape=cq.Workplane('XY').circle(root+0.02).extrude(thickness).val()
        for k in range(teeth):
            angle=2*math.pi*k/teeth; radii=[max(root,base)+(outer-max(root,base))*i/8 for i in range(9)]
            pts=[(root*math.cos(angle-half),root*math.sin(angle-half))]
            pts += [(r*math.cos(angle-half+inv(r)),r*math.sin(angle-half+inv(r))) for r in radii]
            pts += [(r*math.cos(angle+half-inv(r)),r*math.sin(angle+half-inv(r))) for r in reversed(radii)]
            pts += [(root*math.cos(angle+half),root*math.sin(angle+half))]
            shape=shape.fuse(cq.Workplane('XY').polyline(pts).close().extrude(thickness).val())
    else:
        shape=cq.Workplane('XY').circle(radius+1).extrude(thickness).val()
        for k in range(teeth):
            a=2*math.pi*k/teeth
            cutter=cq.Solid.makeCylinder(1.5 if kind=='pulley' else 2.5,thickness+2,cq.Vector((radius+1)*math.cos(a),(radius+1)*math.sin(a),-1))
            shape=shape.cut(cutter)
    return shape.cut(cq.Solid.makeCylinder(4,thickness+2,cq.Vector(0,0,-1)))
def build(ctx):
    parts=[]
    for body in DATA['bodies']:
        for item in body['geometry']:
            kind=item['kind']
            if kind=='box':
                shape=cq.Workplane('XY').box(*item['size']).val()
            elif kind=='shaft':
                shape=cq.Solid.makeCylinder(item['radius'],item['height'])
                # A radial key makes the shaft's angular position visible.
                shape=shape.fuse(cq.Workplane('XY').box(3,3,item['height']).translate((item['radius'],0,item['height']/2)).val())
            else:shape=wheel(item['teeth'],item['radius'],item['thickness'],kind)
            if item.get('phaseDeg'):shape=shape.rotate((0,0,0),(0,0,1),item['phaseDeg'])
            offset=[body['origin'][i]+item.get('offset',[0,0,0])[i] for i in range(3)]
            parts.append({'id':item['id'],'name':item['id'],'color':item['color'],'shape':shape.translate(tuple(offset))})
    return parts
