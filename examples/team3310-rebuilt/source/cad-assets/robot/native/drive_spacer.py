"""Tie-spacer clearance uses two tangent arcs rather than unstable opposed fillets."""
import json,math
from pathlib import Path
import cadquery as cq
from native.manufacturing import build_prismatic_part
reference=json.loads((Path(__file__).parent/'data/drive-spacer.json').read_text())
def make(length,center,angle=0,nutAcrossFlats=9.5758,notchWidth=25.4):
    if length<50 or nutAcrossFlats<=0 or not 3.175<notchWidth<length-30: raise ValueError('Invalid tie spacer dimensions')
    spacing=length-19.05;extension=(spacing-69.85)/2
    outline=[{k:[v[0]+(1 if v[0]>0 else -1)*extension,v[1]] if isinstance(v,list) else v for k,v in e.items()} for e in reference['outline']]
    shape=build_prismatic_part(dict(reference,outline=outline))
    r=1.5875;d=r/math.sqrt(2);left=-notchWidth/2;right=notchWidth/2;a=left-r;c=left+r;e=right-r;g=right+r;z=96.8375
    line=lambda a,b:dict(kind='line',**{'from':a,'to':b})
    arc=lambda a,b,c:dict(kind='arc',**{'from':a,'mid':b,'to':c})
    contour=[line([a,105],[a,98.425]),arc([a,98.425],[a+d,z+d],[left,z]),arc([left,z],[c-d,z-d],[c,95.25]),line([c,95.25],[e,95.25]),arc([e,95.25],[e+d,z-d],[right,z]),arc([right,z],[g-d,z+d],[g,98.425]),line([g,98.425],[g,105]),line([g,105],[a,105])]
    shape=shape.cut(build_prismatic_part(dict(origin=[0,-25,0],normal=[0,-1,0],u=[1,0,0],v=[0,0,1],direction=[0,1,0],depth=50,outline=contour,cutouts=[])))
    for x in [-spacing/2,spacing/2]:
        radius=nutAcrossFlats/math.sqrt(3);points=[[x+radius*math.cos(i*math.pi/3),radius*math.sin(i*math.pi/3)] for i in range(6)]
        shape=shape.cut(build_prismatic_part(dict(origin=[0,0,73.02499],normal=[0,0,1],u=[1,0,0],v=[0,1,0],direction=[0,0,1],depth=25.40002,outline=[line(p,points[(i+1)%6]) for i,p in enumerate(points)],cutouts=[])))
    edges=[edge for edge in shape.Edges() if edge.BoundingBox().zlen<1e-5 and not(edge.BoundingBox().xlen<1e-5 and edge.BoundingBox().xmin>a-.001 and edge.BoundingBox().xmax<g+.001 and edge.BoundingBox().zmin>95)]
    shape=shape.fillet(r,edges)
    return shape.rotate((0,0,0),(0,0,1),angle).translate((center[0],center[1],0))
