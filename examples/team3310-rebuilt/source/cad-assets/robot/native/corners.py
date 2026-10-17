"""Dimensioned corner stock, machining and fitted local rolling blends (mm)."""
import json, math
from pathlib import Path
import cadquery as cq
from OCP.BRep import BRep_Tool
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace,BRepBuilderAPI_MakeWire
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.ShapeFix import ShapeFix_Face
from OCP.gp import gp_Vec
from .manufacturing import build_prismatic_part, fuse


def data(name):
    return json.loads((Path(__file__).parent/'data'/name).read_text())


def surface(d):
    n=d['n'];origin=d.get('fitOrigin',[0,0,0]);scale=d.get('fitScale',1)
    grid=[cq.Vector(*[(v-origin[j])*scale for j,v in enumerate(p)]) for p in d['grid']]
    s=cq.Face.makeSplineApprox([grid[i*n:(i+1)*n] for i in range(n)],tol=.001,minDeg=3,maxDeg=8)
    s=cq.Face(BRepBuilderAPI_MakeFace(BRep_Tool.Surface_s(s.wrapped),.001).Face())
    if scale!=1:s=s.scale(1/scale).translate(origin)
    return s


def blend(d,direction,offset=(0,0,0),analytic=False):
    support=surface(d);edges=[]
    for c in d['curves']:
        kind=c['type']
        if kind=='line':e=cq.Edge.makeLine(*[cq.Vector(*p) for p in c['points']])
        elif kind=='circle' and analytic:e=cq.Edge.makeThreePointArc(*[cq.Vector(*p) for p in c['points']])
        elif analytic:
            e=cq.Edge.makeEllipse(c['major'],c['minor'],angle1=c['first']*180/math.pi,angle2=c['last']*180/math.pi)
            from OCP.gp import gp_Trsf
            tr=gp_Trsf();tr.SetValues(*c['matrix']);e=e.moved(cq.Location(tr))
        else:e=cq.Edge.makeSpline([cq.Vector(*p) for p in c['points']],tol=1e-6)
        edges.append(e)
    maker=BRepBuilderAPI_MakeWire()
    for edge in edges:maker.Add(edge.wrapped)
    wire=cq.Wire(maker.Wire())
    face=None
    for reverse in [True,False]:
        w=wire.wrapped.Reversed() if reverse else wire.wrapped
        from OCP.TopoDS import TopoDS
        f=BRepBuilderAPI_MakeFace(BRep_Tool.Surface_s(support.wrapped),TopoDS.Wire_s(w),True).Face()
        fix=ShapeFix_Face(f);fix.SetPrecision(1e-6);fix.Perform();candidate=cq.Face(fix.Face())
        if candidate.isValid() and candidate.Area()>0:face=candidate;break
    if face is None:raise ValueError('Invalid corner blend trim')
    tool=cq.Shape.cast(BRepPrimAPI_MakePrism(face.wrapped,gp_Vec(*direction)).Shape())
    if tool.Volume()<0:tool=cq.Shape.cast(tool.wrapped.Reversed())
    if not tool.isValid() or tool.Volume()<=0:raise ValueError('Invalid corner blend solid')
    return tool.translate(offset)


def engrave(shape,glyphs,depth):
    for p in glyphs:
        profile={**p,'origin':[0,0,152.4-depth],'u':[1,0,0],'v':[0,1,0],'normal':[0,0,1],'direction':[0,0,1],'depth':depth+.00001}
        shape=shape.cut(build_prismatic_part(profile))
    return shape


def stock(d,rear,holeScale):
    shape=fuse([build_prismatic_part(d['base'],depth=43.18),build_prismatic_part(d['upper'])])
    if rear:
        z=lambda y:127.66453616635297+1.156499983259559*(y-318.92099058220407)
        frame={'origin':[-342.9,0,0],'normal':[1,0,0],'u':[0,1,0],'v':[0,0,1],'direction':[-1,0,0]}
    else:
        z=lambda x:128.25343807251843+(.48283920895399834/.875709026044997)*(x-278.7862031505709)
        frame={'origin':[0,342.7222,0],'normal':[0,-1,0],'u':[1,0,0],'v':[0,0,1],'direction':[0,1,0]}
    points=[[200,z(200)],[400,z(400)],[400,250],[200,250]]
    shape=shape.cut(build_prismatic_part({**frame,'depth':60,'outline':[{'kind':'line','from':p,'to':points[(i+1)%4]} for i,p in enumerate(points)],'cutouts':[]}))
    edges=[]
    for edge in shape.Edges():
        faces=edge.ancestors(shape,'Face').Faces()
        if len(faces)!=2:raise ValueError('Nonmanifold corner stock')
        from OCP.BRepAdaptor import BRepAdaptor_Curve
        curve=BRepAdaptor_Curve(edge.wrapped);point=cq.Vector(curve.Value((curve.FirstParameter()+curve.LastParameter())*.5))
        a,b=[f.normalAt(point) for f in faces]
        if abs(a.dot(b))<.99999:edges.append(edge)
    shape=shape.fillet(1.016,edges)
    return shape.cut(cq.Solid.makeCylinder(4.826*holeScale,43.18002,cq.Vector(-330.2 if rear else 330.2,330.2,101.59999)))


def make(rear=False,right=False,holeScale=1,engravingDepth=1.5875):
    if not math.isfinite(holeScale) or holeScale<=0 or not math.isfinite(engravingDepth) or not 0<engravingDepth<=5:raise ValueError('Positive bore scale and engraving depth up to 5 mm required')
    d=data('corners-'+('rear' if rear else 'front')+'.json');shape=stock(d,rear,holeScale)
    if not right:shape=engrave(shape,d['glyphs'],engravingDepth)
    if not rear:
        top=surface(d['top']).translate((0,0,-.0001))
        cutter=cq.Shape.cast(BRepPrimAPI_MakePrism(top.wrapped,gp_Vec(0,0,3)).Shape())
        if cutter.Volume()<0:cutter=cq.Shape.cast(cutter.wrapped.Reversed())
        shape=shape.cut(cutter)
    side=blend(d['step'],[1,1,-2],[-.001,-.0001,.0001]);other=side.mirror((1,-1,0))
    for tool in [side,other]:shape=shape.fuse(tool.mirror((1,0,0)) if rear else tool)
    if rear:
        top=d['top'];shape=shape.cut(blend(top,top['direction'],top['offset']))
        shape=shape.fuse(blend(d['bottom'],[2,2,0],[-.0001,-.0001,0],True))
        shape=shape.cut(blend(d['bottom'],[-2,-2,0],[.0001,.0001,0],True))
    if not shape.isValid():
        # OCCT 7.8 can leave a microscopic unorientable trim on the top blend.
        # Exchange only the freshly generated shape to rebuild consistent pcurves;
        # no imported/original part file is used as geometry.
        import tempfile
        with tempfile.TemporaryDirectory(prefix='cadcove-corner-') as folder:
            path=str(Path(folder)/'generated.step')
            cq.exporters.export(shape,path)
            shape=cq.importers.importStep(path).val()
    if right:shape=engrave(shape.mirror((0,1,0)),data('corners-right-'+('rear' if rear else 'front')+'-glyphs.json'),engravingDepth)
    if not shape.isValid():raise ValueError('Invalid manufactured corner')
    return shape
