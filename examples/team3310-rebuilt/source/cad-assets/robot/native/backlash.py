"""Machined backlash plates with rounded rims, nut pockets and radial cross bores."""
import math, copy, json
from pathlib import Path
import cadquery as cq
from .manufacturing import build_prismatic_part, fuse


def data(name):return json.loads((Path(__file__).parent/'data'/('backlash-'+name+'-stock.json')).read_text())
def near(a,b,tol=1e-5):return math.dist(a,b)<tol
def sharp_corners(profile):
    corners=[]
    for arc in [e for e in profile['outline'] if e['kind']=='arc' and math.dist(e['to'],e['from'])<3]:
        adjacent=[e for e in profile['outline'] if e['kind']=='line' and any(near(p,arc['from']) or near(p,arc['to']) for p in [e['from'],e['to']])]
        if len(adjacent)!=2:raise ValueError('Corner adjacency')
        a,c=adjacent;p=a['from'];r=[v-w for v,w in zip(a['to'],p)];q=c['from'];s=[v-w for v,w in zip(c['to'],q)]
        cross=lambda x,y:x[0]*y[1]-x[1]*y[0]
        t=cross([v-w for v,w in zip(q,p)],s)/cross(r,s);corner=[v+t*w for v,w in zip(p,r)]
        for e in adjacent:
            for key in ['from','to']:
                if near(e[key],arc['from']) or near(e[key],arc['to']):e[key]=corner
        corners.append(corner);profile['outline'].remove(arc)
    return corners

def drill(shape,holes,holeScale):
    for h in holes:
        shape=shape.cut(cq.Solid.makeCylinder(h['radius']*holeScale,h['length']+.00002,cq.Vector(*[v-a*.00001 for v,a in zip(h['at'],h['axis'])]),cq.Vector(*h['axis'])))
    return shape

def left(holeScale=1,hubLength=12.7,edgeRadius=1.5875):
    d=data('left');layers=d['layers'];plate=copy.deepcopy({**layers[0],'depth':6.35,'cutouts':[]});corners=sharp_corners(plate)
    shape=fuse([build_prismatic_part(plate),cq.Solid.makeCylinder(14.2875,hubLength+.00001,cq.Vector(314.325,11.93799,182.0333418),cq.Vector(0,1,0)),cq.Solid.makeCylinder(7.9375,.84456,cq.Vector(314.325,11.93799+hubLength,182.0333418),cq.Vector(0,1,0))])
    edges=[]
    for e in shape.Edges():
        q=e.BoundingBox();r=e.Length()/(2*math.pi) if e.geomType()=='CIRCLE' else 0
        atbase=q.ylen<1e-5 and abs(q.ymin-11.938)<1e-5
        if (abs(r-14.2875)>1e-5 if atbase else q.ylen<1e-5 and abs(q.ymin-5.588)<1e-5) or q.ylen<1e-5 and abs(q.ymin-(11.938+hubLength))<1e-5 and abs(r-14.2875)<1e-5 or any(abs(q.zmin-p[0])<1e-5 and abs(q.xmin-p[1])<1e-5 and q.zlen<1e-5 and q.xlen<1e-5 for p in corners):edges.append(e)
    shape=shape.fillet(edgeRadius,edges)
    cuts=[build_prismatic_part({**layers[0],'origin':[0,5.58799,0],'depth':hubLength+7.19458,'outline':layers[0]['cutouts'][0],'cutouts':[]})]
    for layer in layers[:2]:
        for outline in layer['cutouts'][1:]:cuts.append(build_prismatic_part({**layer,'origin':[v-(.00001 if i==1 else 0) for i,v in enumerate(layer['origin'])],'depth':layer['depth']+.00002,'outline':outline,'cutouts':[]}))
    for tool in cuts:shape=shape.cut(tool)
    return drill(shape,d['holes'],holeScale)

def right(holeScale=1,hubLength=25.4,edgeRadius=1.5875):
    d=data('right');plate=copy.deepcopy({**d['plate'],'origin':[0,-11.938,0],'depth':6.35,'cutouts':[]});corners=sharp_corners(plate)
    flat=next(e for e in plate['outline'] if e['kind']=='line' and abs(e['from'][0]-165.1)<1e-6 and abs(e['to'][0]-165.1)<1e-6)
    slope=next(e for e in plate['outline'] if e['kind']=='line' and e is not flat and any(near(p,[165.1,339.725],1e-6) for p in [e['from'],e['to']]))
    arc=next(e for e in plate['outline'] if e['kind']=='arc' and any(near(p,[165.1,355.423229104],1e-6) for p in [e['from'],e['to']]))
    a=slope['from'];direction=[v-w for v,w in zip(slope['to'],a)];center=[182.0333418,314.325];q=[v-w for v,w in zip(a,center)]
    A=sum(v*v for v in direction);B=2*sum(v*w for v,w in zip(q,direction));C=sum(v*v for v in q)-44.45**2;t=(-B+math.sqrt(B*B-4*A*C))/(2*A);hit=[v+t*w for v,w in zip(a,direction)]
    for key in ['from','to']:
        if near(slope[key],[165.1,339.725]):slope[key]=hit
        if near(arc[key],[165.1,355.423229104]):arc[key]=hit
    theta0=math.atan2(arc['from'][0]-center[0],arc['from'][1]-center[1]);theta1=math.atan2(arc['to'][0]-center[0],arc['to'][1]-center[1]);theta=theta0+((theta1-theta0+math.pi*3)%(2*math.pi)-math.pi)/2
    arc['mid']=[center[0]+44.45*math.sin(theta),center[1]+44.45*math.cos(theta)];plate['outline'].remove(flat);corners.append([220.3530340703,336.8506228396])
    web=copy.deepcopy(d['web'])
    # Share exact circle centres/radii between touching stock profiles.
    canonicalize([plate,web])
    rear=profile(plate)
    edges=[]
    for e in rear.Edges():
        q=e.BoundingBox()
        if q.ylen<1e-5 or any(abs(q.zmin-p[0])<1e-5 and abs(q.xmin-p[1])<1e-5 and q.zlen<1e-5 and q.xlen<1e-5 for p in corners):edges.append(e)
    rear=rear.fillet(edgeRadius,edges).intersect(build_prismatic_part({**d['plateTrim'],'origin':[0,-11.93801,0],'depth':6.35002,'cutouts':[]}))
    def slab(low,high):return cq.Solid.makeBox(200,high-low,200,cq.Vector(230,low,90))
    front=rear.intersect(slab(-11.938,-11.938+edgeRadius)).translate((0,11.938,0)).fuse(rear.intersect(slab(-5.588-edgeRadius,-5.588)).translate((0,8.763,0)))
    web=profile({**web,'origin':[0,-11.938+edgeRadius,0],'depth':15.113-2*edgeRadius})
    hub=cq.Solid.makeCylinder(14.2875,hubLength,cq.Vector(314.325,3.175,182.0333418),cq.Vector(0,1,0))
    hub=hub.fillet(edgeRadius,[e for e in hub.Edges() if e.BoundingBox().ylen<1e-5 and abs(e.BoundingBox().ymin-(3.175+hubLength))<1e-5])
    shape=fuse([rear,front,web,hub])
    cuts=[build_prismatic_part({**d['plate'],'origin':[0,-11.93801,0],'depth':15.113+hubLength+.00002,'outline':d['plate']['cutouts'][0],'cutouts':[]})]
    for outline in d['plate']['cutouts'][1:]:cuts.append(build_prismatic_part({**plate,'origin':[0,-11.93801,0],'depth':15.11302,'outline':outline,'cutouts':[]}))
    for outline in d['pockets']:cuts.append(build_prismatic_part({**plate,'origin':[0,-11.93801,0],'depth':3.17502,'outline':outline,'cutouts':[]}))
    for tool in cuts:shape=shape.cut(tool)
    return drill(shape,d['holes'],holeScale)

def canonicalize(profiles):
    circles=[]
    for p in profiles:
        for e in p['outline']:
            if e['kind']!='arc':continue
            a,c,d=e['from'],e['mid'],e['to'];u=[v-w for v,w in zip(c,a)];v=[v-w for v,w in zip(d,a)];den=2*(u[0]*v[1]-u[1]*v[0]);us=sum(x*x for x in u);vs=sum(x*x for x in v)
            center=[a[0]+(us*v[1]-vs*u[1])/den,a[1]+(u[0]*vs-v[0]*us)/den];radius=math.dist(a,center)
            match=next((q for q in circles if math.dist(q[0],center)<1e-5 and abs(q[1]-radius)<1e-5),None)
            if match:center,radius=match
            else:circles.append((center,radius))
            e['center']=center;e['radius']=radius

def profile(p):
    from OCP.gp import gp_Ax2,gp_Dir,gp_Pnt,gp_Circ
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    def point(v):return cq.Vector(*[a+v[0]*u+v[1]*w for a,u,w in zip(p['origin'],p['u'],p['v'])])
    edges=[]
    for e in p['outline']:
        if e['kind']=='line':edges.append(cq.Edge.makeLine(point(e['from']),point(e['to'])));continue
        axis=gp_Ax2(point(e['center']).toPnt(),gp_Dir(*p['normal']));x=cq.Vector(axis.XDirection());y=cq.Vector(axis.YDirection());center=point(e['center'])
        def angle(q):
            delta=point(q)-center
            return math.atan2(delta.dot(y),delta.dot(x))
        start,end,mid=[angle(e[k]) for k in ['from','to','mid']];reverse=(mid-start)%(2*math.pi)>(end-start)%(2*math.pi)
        if reverse:start,end=end,start
        end=start+(end-start)%(2*math.pi)
        edge=cq.Edge(BRepBuilderAPI_MakeEdge(gp_Circ(axis,e['radius']),start,end).Edge())
        if reverse:edge=cq.Edge(edge.wrapped.Reversed())
        edges.append(edge)
    return cq.Solid.extrudeLinear(cq.Wire.assembleEdges(edges),[],cq.Vector(*[v*p['depth'] for v in p['direction']]))

def trim_parameters(rightSide,holeScale,hubLength):
    ds=json.loads((Path(__file__).parent/'data'/('backlash-'+('right' if rightSide else 'left')+'-trims.json')).read_text())
    axis=[math.sqrt(3)/2,0,-.5];tangent=[.5,0,math.sqrt(3)/2];radius=14.2875
    dot=lambda a,b:sum(v*w for v,w in zip(a,b))
    def hub_point(p):
        if holeScale==1:return p[:]
        y=(9.525 if abs(p[1]-9.525)<abs(p[1]-22.225) else 22.225) if rightSide else 17.526
        hub=[314.325,y,182.0333418];q=[v-w for v,w in zip(p,hub)];side=1 if dot(q,axis)>=0 else -1;t=dot(q,tangent)*holeScale;r2=radius*radius-t*t
        if r2<=0:raise ValueError('Cross drill exceeds hub radius')
        r=side*math.sqrt(r2)
        return [hub[0]+r*axis[0]+t*tangent[0],hub[1]+q[1]*holeScale,hub[2]+r*axis[2]+t*tangent[2]]
    for d in ds:
        isHub=d['index']==0;delta=hubLength-(25.4 if rightSide else 12.7)
        if isHub:d['origin'][1]+=delta
        else:d['radius']*=holeScale
        def bore_point(p):
            q=[v-w for v,w in zip(p,d['origin'])];a=[d['linear'][i] for i in [2,5,8]];axial=dot(q,a)
            return [v+axial*a[i]+(q[i]-axial*a[i])*holeScale for i,v in enumerate(d['origin'])]
        for e in d['edges']:
            if e['type']=='pcurve':e['points']=[hub_point(p) for p in e['points']]
            elif isHub and 'points' in e:e['points']=[[v+(delta if i==1 and abs(v-(26.9875 if rightSide else 23.0505))<1e-6 else 0) for i,v in enumerate(p)] for p in e['points']]
            elif not isHub and e['type']=='circleFull':e['radius']*=holeScale
            elif not isHub and 'points' in e:e['points']=[hub_point(p) if abs(math.hypot(p[0]-314.325,p[2]-182.0333418)-radius)<1e-6 else bore_point(p) for p in e['points']]
    return ds


def rebuilt_trims(shape,rightSide,holeScale,hubLength):
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace,BRepBuilderAPI_MakeWire,BRepBuilderAPI_Sewing,BRepBuilderAPI_MakeSolid
    from OCP.ShapeFix import ShapeFix_Face,ShapeFix_Wire
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FORWARD
    from OCP.gp import gp_Trsf
    def transform(s,linear,origin):
        t=gp_Trsf();t.SetValues(*[value for i in range(3) for value in [*linear[i*3:i*3+3],origin[i]]]);return s.moved(cq.Location(t))
    def healed(face):
        fixer=ShapeFix_Face(face);fixer.SetPrecision(1e-6);fixer.Perform();return cq.Face(fixer.Face())
    faces=shape.Faces();remove=set();rebuilt=[];shared={}
    for d in trim_parameters(rightSide,holeScale,hubLength):
        support=transform(cq.Solid.makeCylinder(d['radius'],100),d['linear'],d['origin'])
        support=next(f for f in support.Faces() if f.geomType()=='CYLINDER')
        edges=[]
        for e in d['edges']:
            if e.get('sourceEdge') and e['sourceEdge'] in shared:edge=shared[e['sourceEdge']]
            elif e['type']=='line':edge=cq.Edge.makeLine(*[cq.Vector(*p) for p in e['points']])
            elif e['type']=='arc':edge=cq.Edge.makeThreePointArc(*[cq.Vector(*p) for p in e['points']])
            elif e['type']=='circleFull':edge=transform(cq.Edge.makeCircle(e['radius']),e['linear'],e['origin'])
            else:
                origin=e['points'][0];points=e['points'][:-1] if e.get('closed') else e['points']
                edge=cq.Edge.makeSpline([cq.Vector(*[(v-origin[i])*1000 for i,v in enumerate(p)]) for p in points],periodic=e.get('closed',False),tol=1e-7).scale(.001).translate(origin)
                if e.get('sourceEdge'):shared[e['sourceEdge']]=edge
            edges.append(edge)
        wires=[]
        for w in d['wires']:
            maker=BRepBuilderAPI_MakeWire()
            for x in w['edges']:maker.Add(TopoDS.Edge_s(edges[x['edge']].wrapped.Reversed() if x['reverse'] else edges[x['edge']].wrapped))
            wires.append((w['outer'],cq.Wire(maker.Wire())))
        outer=next((w for isouter,w in wires if isouter),wires[0][1]);holes=[w for _,w in wires if w is not outer];choices=[]
        for reverse in [False,True]:
            try:
                face=healed(BRepBuilderAPI_MakeFace(BRep_Tool.Surface_s(support.wrapped),TopoDS.Wire_s(outer.wrapped.Reversed() if reverse else outer.wrapped),True).Face())
                if holes:
                    maker=BRepBuilderAPI_MakeFace(face.wrapped)
                    for hole in holes:
                        fixer=ShapeFix_Wire(hole.wrapped,face.wrapped,1e-6);fixer.FixEdgeCurves();maker.Add(fixer.Wire())
                    fixer=ShapeFix_Face(maker.Face());fixer.FixOrientation();fixer.Perform();face=healed(fixer.Face())
                if face.isValid() and face.Area()>0:choices.append(face)
            except Exception:pass
        if not choices:raise ValueError('Cannot rebuild cross-drill cylinder '+str(d['index']))
        face=min(choices,key=lambda f:abs(f.Area()-d['area']))
        if (face.wrapped.Orientation()==TopAbs_FORWARD)!=(d['orientation']=='forward'):face=cq.Face(face.wrapped.Reversed())
        # Native and WASM topology orders differ. Match the cylinder radius and
        # the completed trim centre, never a transient face index.
        candidates=[(i,f) for i,f in enumerate(faces) if i not in remove and f.geomType()=='CYLINDER' and abs(BRepAdaptor_Surface(f.wrapped).Cylinder().Radius()-d['radius'])<1e-5]
        if not candidates:raise ValueError('Missing cross-drill stock cylinder')
        index,old=min(candidates,key=lambda pair:(pair[1].Center()-face.Center()).Length)
        if (old.Center()-face.Center()).Length>1:raise ValueError('Changed cross-drill stock topology')
        remove.add(index);rebuilt.append(face)
    sewer=BRepBuilderAPI_Sewing(.0001)
    for i,f in enumerate(faces):
        if i not in remove:sewer.Add(f.wrapped)
    for f in rebuilt:sewer.Add(f.wrapped)
    sewer.Perform();sewn=cq.Shape.cast(sewer.SewedShape());shells=sewn.Shells()
    if len(shells)!=1:raise ValueError('Cross-drill repair did not produce one shell')
    s=cq.Solid(BRepBuilderAPI_MakeSolid(shells[0].wrapped).Solid())
    if s.Volume()<0:s=cq.Solid(s.wrapped.Reversed())
    return s.fix()


def make(rightSide=False,holeScale=1,hubLength=None):
    if hubLength is None:hubLength=25.4 if rightSide else 12.7
    if not math.isfinite(holeScale) or holeScale<=0 or not math.isfinite(hubLength) or hubLength<=(1.5875 if rightSide else 0):raise ValueError('Positive bore scale and valid hub length required')
    supportLength=max(hubLength,22.225+4.445*holeScale+1.5875-3.175+.1) if rightSide else hubLength
    s=right(holeScale,supportLength) if rightSide else left(holeScale,supportLength)
    if rightSide:s=normalize(s)
    s=normalize(rebuilt_trims(s,rightSide,holeScale,supportLength))
    if supportLength!=hubLength:
        cap=cq.Solid.makeCylinder(14.2875,hubLength,cq.Vector(314.325,3.175,182.0333418),cq.Vector(0,1,0));top=3.175+hubLength
        cap=cap.fillet(1.5875,[e for e in cap.Edges() if e.BoundingBox().ylen<1e-6 and abs(e.BoundingBox().ymin-top)<1e-6]);low=top-1.5875;high=3.175+supportLength+1
        zone=cq.Solid.makeBox(100,high-low,100,cq.Vector(264.325,low,132.0333418))
        s=normalize(s.cut(zone.cut(cap)).fix())
    if not s.isValid():raise ValueError('Invalid manufactured backlash plate')
    return s


def normalize(shape):
    # Roundtrip only newly generated native geometry, matching the original
    # model's OCCT exchange repair of inconsistent cross-drill pcurves.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='cadcove-backlash-') as folder:
        path=str(Path(folder)/'generated.step')
        cq.exporters.export(shape,path)
        return cq.importers.importStep(path).val()
