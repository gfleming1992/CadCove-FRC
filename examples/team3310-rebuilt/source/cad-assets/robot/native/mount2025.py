"""35-degree equipment mount: rounded stock, trimmed corner blends and drilling."""
import json, math
from pathlib import Path
import cadquery as cq
from OCP.gp import gp_Trsf, gp_Elips, gp_Ax2, gp_Pnt, gp_Dir
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace
from OCP.BRep import BRep_Tool
from OCP.ShapeFix import ShapeFix_Face
from native.manufacturing import build_prismatic_part, fuse
from native.surface_tools import bspline_support, wire, reverse, sew_solid
DATA=Path(__file__).parent/'data'
def data(name):return json.loads((DATA/f'mount2025-{name}.json').read_text())
D=data('stock')
def point(e,t):
    a=e._geomAdaptor();return e.positionAt(a.FirstParameter()+(a.LastParameter()-a.FirstParameter())*t,'parameter')
def curve(c):
    if c['type']=='line':return cq.Edge.makeLine(*[cq.Vector(*p) for p in c['points']])
    if c['type']=='circle':return cq.Edge.makeThreePointArc(*[cq.Vector(*p) for p in c['points']])
    ellipse=gp_Elips(gp_Ax2(gp_Pnt(0,0,0),gp_Dir(0,0,1)),c['major'],c['minor'])
    e=cq.Edge(BRepBuilderAPI_MakeEdge(ellipse,c['first'],c['last']).Edge())
    tr=gp_Trsf();tr.SetValues(*c['matrix']);return e.moved(cq.Location(tr))
def face_on(s,w):
    for boundary in [w,reverse(w)]:
        f=BRepBuilderAPI_MakeFace(BRep_Tool.Surface_s(s.wrapped),boundary.wrapped,True).Face()
        fix=ShapeFix_Face(f);fix.SetPrecision(1e-6);fix.Perform();f=cq.Face(fix.Face())
        if f.isValid() and f.Area()>0:return f
    raise ValueError('Invalid mount trim')
def rounded(windowLength):
    s=build_prismatic_part(D['stockProfile']);edges=[]
    for e in s.Edges():
        b=e.BoundingBox()
        if abs(b.xlen)<1e-5 and ((abs(b.ymin-279.4)<1e-5 and abs(b.ymax-279.4)<1e-5) or (abs(b.ymin-311.15)<1e-5 and abs(b.ymax-311.15)<1e-5) or (abs(b.ymin-245.08840385434334)<1e-5 and b.ymax<249)):edges.append(e)
    s=s.fillet(5.08,edges)
    p=[[0,0],[50.8,0],[50.8,windowLength],[0,windowLength]];frame=D['windowFrame']
    cutter=build_prismatic_part({**frame,'outline':[{'kind':'line','from':v,'to':p[(i+1)%4]} for i,v in enumerate(p)],'cutouts':[]})
    cutter=cutter.fillet(5.08,[e for e in cutter.Edges() if abs(e.Length()-frame['depth'])<1e-5])
    s=s.cut(cutter);return s.fillet(1.5875,s.Edges())
def make(holeScale=1,windowLength=D['parameters']['windowLength']):
    if not math.isfinite(holeScale) or holeScale<=0 or not math.isfinite(windowLength) or windowLength<=10.16:raise ValueError('Positive clearance and window longer than corner diameter required')
    s=rounded(windowLength);faces=s.Faces();replaced={};patches=[]
    for d in data('blends'):
        support=bspline_support(d['grid'],d['n'],d['fitOrigin'],d['fitScale'])
        patches.append(face_on(support,reverse(wire([curve(c) for c in d['curves']]))))
    for d in data('trims'):
        choices=[(math.dist(f.Center().toTuple(),d['center']),i,f) for i,f in enumerate(faces) if f.geomType().lower()==d['type']]
        distance,i,f=min(choices,key=lambda x:x[0])
        if distance>2:raise ValueError('Missing mount trim support')
        fresh=face_on(f,wire([curve(c) for c in d['curves']]))
        for hole in sorted(f.Wires(),key=lambda w:w.Length(),reverse=True)[1:]:fresh=fresh.cut(face_on(f,hole))
        if len(fresh.Faces())!=1:raise ValueError('Expected one trimmed face')
        fresh=fresh.Faces()[0]
        if fresh.wrapped.Orientation()!=f.wrapped.Orientation():fresh=reverse(fresh)
        replaced[i]=fresh
    s=sew_solid([replaced.get(i,f) for i,f in enumerate(faces) if f.geomType()!='BSPLINE']+patches,1e-5)
    if not s.isValid():raise ValueError('Invalid trimmed mount solid')
    holes=[cq.Solid.makeCylinder(h['radius']*holeScale,h['length']+.00002,cq.Vector(*[p-a*.00001 for p,a in zip(h['at'],h['axis'])]),cq.Vector(*h['axis'])) for h in D['screwHoles']]
    s=s.cut(fuse(holes));mouths=[]
    for e in s.Edges():
        if e.geomType()!='CIRCLE' or not e.IsClosed():continue
        a,b=point(e,0),point(e,.5);radius=(a-b).Length/2
        if not any(abs(r*holeScale-radius)<1e-5 for r in [2.5527,2.4892]):continue
        if all(abs(p.z-152.4)<1e-5 for p in [a,b]) or all(abs(p.dot(cq.Vector(*D['windowFrame']['normal']))-308.5086952014907)<1e-5 for p in [a,b]):mouths.append(e)
    s=s.fillet(1.5875,mouths)
    return s.cut(fuse([cq.Solid.makeCylinder(4.7625*holeScale,20,cq.Vector(x,304.8,158.75)) for x in [-279.4,-228.6]]))
