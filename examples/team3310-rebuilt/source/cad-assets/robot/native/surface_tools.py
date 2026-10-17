"""Native OCCT construction for explicitly controlled rolling blends and trims.

Point grids and boundary curves are authored numeric geometry, never serialized
STEP/BREP. Fitting is performed in local coordinates to retain small-radius detail.
"""
import math
import cadquery as cq
from OCP.gp import gp_Pnt, gp_Dir, gp_Ax3, gp_Pln, gp_Cylinder, gp_Torus, gp_Sphere, gp_Trsf
from OCP.GeomAPI import GeomAPI_Interpolate, GeomAPI_PointsToBSplineSurface
from OCP.TColgp import TColgp_HArray1OfPnt, TColgp_Array2OfPnt
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakeWire, BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid
from OCP.BRep import BRep_Tool
from OCP.ShapeFix import ShapeFix_Wire, ShapeFix_Face
from OCP.TopoDS import TopoDS
from OCP.TopAbs import TopAbs_REVERSED


def reverse(shape):
    return cq.Shape.cast(shape.wrapped.Reversed())


def fit_curve(points):
    origin=points[0]; scale=1000
    arr=TColgp_HArray1OfPnt(1,len(points))
    for i,p in enumerate(points): arr.SetValue(i+1,gp_Pnt(*[(v-o)*scale for v,o in zip(p,origin)]))
    fit=GeomAPI_Interpolate(arr,False,1e-6);fit.Perform()
    return cq.Edge(BRepBuilderAPI_MakeEdge(fit.Curve()).Edge()).scale(1/scale).translate(origin)


def bspline_support(grid,n,origin=None,fitScale=1):
    origin=origin or [0,0,0]
    points=TColgp_Array2OfPnt(1,n,1,n)
    for i in range(n):
        for j in range(n): points.SetValue(i+1,j+1,gp_Pnt(*[(p-o)*fitScale for p,o in zip(grid[i*n+j],origin)]))
    fit=GeomAPI_PointsToBSplineSurface(points)
    face=cq.Face(BRepBuilderAPI_MakeFace(fit.Surface(),1e-6).Face())
    return face.scale(1/fitScale).translate(origin)


def support(d):
    t=d['type'];origin=d['origin']
    if t=='plane':
        u=cq.Vector(*d['u']);v=cq.Vector(*d['v']);normal=u.cross(v).normalized().toTuple()
        geom=gp_Pln(gp_Ax3(gp_Pnt(*origin),gp_Dir(*normal),gp_Dir(*d['u'])))
    else:
        axis=gp_Dir(*d.get('axis',[0,0,1]));radial=d.get('radial')
        ax=gp_Ax3(gp_Pnt(*origin),axis,gp_Dir(*radial)) if radial else gp_Ax3(gp_Pnt(*origin),axis)
        if t=='cylinder': geom=gp_Cylinder(ax,d['radius'])
        elif t=='torus': geom=gp_Torus(ax,d['major'],d['minor'])
        elif t=='sphere': geom=gp_Sphere(ax,d['radius'])
        else: raise ValueError('Unsupported surface '+t)
    return cq.Face(BRepBuilderAPI_MakeFace(geom).Face())


def wire(edges):
    maker=BRepBuilderAPI_MakeWire()
    for e in edges:
        if e is not None: maker.Add(e.wrapped)
    if not maker.IsDone(): raise ValueError('Disconnected trim boundary')
    return cq.Wire(maker.Wire())


def edge(d):
    points=d.get('points')
    if points and max(math.dist(p,points[0]) for p in points)<1e-9:return None
    if d['type']=='line':return cq.Edge.makeLine(*[cq.Vector(*p) for p in points])
    if d['type']=='circleFull':return cq.Edge.makeCircle(d['radius'],d['center'],d['normal'])
    if d['type']=='circle':return cq.Edge.makeThreePointArc(*[cq.Vector(*p) for p in points])
    return fit_curve(points)


def trimmed_face(support,outer,holes=None,area=None,orientation=None,fix=True,tolerance=.05):
    holes=holes or [];best=None;failures=[]
    for rev in [False,True]:
        try:
            w=reverse(outer) if rev else outer
            if fix:
                fw=ShapeFix_Wire(w.wrapped,support.wrapped,1e-5);fw.Perform();w=cq.Wire(fw.Wire())
            maker=BRepBuilderAPI_MakeFace(BRep_Tool.Surface_s(support.wrapped),w.wrapped,True)
            healer=ShapeFix_Face(maker.Face());healer.SetPrecision(1e-6);healer.Perform()
            face=cq.Face(healer.Face())
            if holes:
                maker=BRepBuilderAPI_MakeFace(face.wrapped)
                for h in holes:
                    fw=ShapeFix_Wire(h.wrapped,face.wrapped,1e-6);fw.Perform();maker.Add(fw.Wire())
                healer=ShapeFix_Face(maker.Face());healer.SetPrecision(1e-6);healer.Perform();face=cq.Face(healer.Face())
            a=face.Area();error=abs(a-area) if area is not None else 0
            if face.isValid() and a>0 and (best is None or error<best[0]):best=(error,face)
        except Exception as e:failures.append(str(e))
    if best is None or (area is not None and best[0]>tolerance):raise ValueError(f'Invalid trim: target={area}, error={best[0] if best else None}, failures={failures}')
    face=best[1]
    if orientation is not None and (face.wrapped.Orientation()==TopAbs_REVERSED)!=(orientation=='reversed'):face=reverse(face)
    return face


def sew_solid(faces,tolerance=.001):
    sewing=BRepBuilderAPI_Sewing(tolerance)
    for face in faces:sewing.Add(face.wrapped)
    sewing.Perform();sewed=cq.Shape.cast(sewing.SewedShape());shells=sewed.Shells()
    if len(shells)!=1:raise ValueError(f'Expected one shell, got {len(shells)}')
    solid=cq.Solid(BRepBuilderAPI_MakeSolid(shells[0].wrapped).Solid())
    if solid.Volume()<0:solid=reverse(solid)
    return solid
