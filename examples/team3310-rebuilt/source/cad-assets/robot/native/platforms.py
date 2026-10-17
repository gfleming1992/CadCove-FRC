"""Platform guards: analytic stock boundaries with explicit rolling transitions."""
import json, math
from pathlib import Path
import cadquery as cq
from . import surface_tools as st
from .manufacturing import build_prismatic_part,fuse


def data(name):
    root=Path(__file__).parent/'data'
    result=json.loads((root/f'{name}.json').read_text())
    result['patches']=[p for ref in result.pop('patchFiles') for p in json.loads((root/ref).read_text())]
    return result


def panel(number,drill=True,**options):
    d=data(f'platform{number}');trims=d['trims'];edges=[st.edge(e) for e in trims['edges']];faces=[]
    for desc in trims['faces']:
        s=desc['support']
        if s['type'] in ('plane','cylinder','sphere','torus'):support=st.support(s)
        else:
            patch=next(p for p in d['patches'] if p['index']==desc['index'])
            support=st.bspline_support(patch['grid'],patch['n'],patch['origin'],patch['fitScale'])
        pc=next((p for p in d['pcurves'] if p['face']==desc['index']),None)
        if pc:
            ends=[x for e in pc['edges'] for x in [e['samples'][0][2:],e['samples'][-1][2:]]];curves=[]
            for e in pc['edges']:
                points=[p[2:] for p in e['samples']]
                for i in [0,len(points)-1]:
                    near=[x for x in ends if math.dist(x,points[i])<1e-4]
                    points[i]=[sum(p[j] for p in near)/len(near) for j in range(3)]
                h=st.fit_curve(points);curves.append(st.reverse(h) if e['reversed'] else h)
            wires=[(True,st.wire(curves))]
        else:wires=[(w['outer'],st.wire([st.reverse(edges[e['edge']]) if e['reverse'] else edges[e['edge']] for e in w['edges'] if edges[e['edge']] is not None])) for w in desc['wires']]
        outer=next((w for flag,w in wires if flag),wires[0][1]);holes=[w for flag,w in wires if w is not outer]
        try:face=st.trimmed_face(support,outer,holes,desc['area'],desc['orientation'])
        except Exception as e:raise ValueError(f'Platform {number} face {desc["index"]}: {e}') from e
        faces.append(face)
    solid=st.sew_solid(faces,.001)
    if number=='014':
        hs=options.get('holeScale',1)
        if not math.isfinite(hs) or not .8<=hs<=1.2:raise ValueError('Hole scale must be between 0.8 and 1.2')
        bores=[[-26.66516590141,-320.3575,2.286],[-26.66516590141,-304.2689823947,2.286],[15.547409754405,-300.0375,2.5527],[15.547409754405,-309.5625,2.5527],[25.072409754405,-300.0375,2.5527],[20.309909754405,-304.8,2.5527],[25.072409754405,-309.5625,2.5527]]
        if drill:
            for x,y,r in bores:solid=solid.cut(cq.Solid.makeCylinder(r*hs,30,(x,y,520),(0,0,1)))
    else:
        radius=options.get('mountingHoleRadius',2.2479)
        if not math.isfinite(radius) or not 0<radius<4:raise ValueError('Mounting bore radius must be between 0 and 4 mm')
        if drill:
            for x,z in [[-265.5140469131,242.89098884068],[-282.3319913568,331.18851527745]]:solid=solid.cut(cq.Solid.makeCylinder(radius,156,(x,-253,z),(0,1,0)))
    if not solid.isValid() or len(solid.Solids())!=1:raise ValueError('Platform failed solid validation')
    return solid


def midpoint(edge):
    curve=edge._geomAdaptor()
    return edge.positionAt((curve.FirstParameter()+curve.LastParameter())/2,'parameter')


def guard_stock(d):
    z=393.2682;thickness=6.35;height=25.4;cx=-162.5586951227978;cy=-173.4981036
    def section(outline,at,depth):
        return build_prismatic_part(dict(origin=[0,0,at],normal=[0,0,1],u=[1,0,0],v=[0,1,0],direction=[0,0,1],depth=depth,outline=outline,cutouts=[]))
    p=d['profiles'];shape=section(p['Sketch 135'][0],z,thickness).fuse(section(p['Sketch 136'][0],z+thickness-.00001,height+.00001))
    shape=shape.fuse(*[section(o,z+thickness-.00001,height+.00001) for o in p['Sketch 137']])
    start=z+thickness+3.175
    envelope=cq.Solid.makeCylinder(181,start-z+1,(cx,cy,z-1)).fuse(cq.Solid.makeCone(180.18125,169.59891182775,height-3.175,(cx,cy,start)))
    shape=shape.intersect(envelope)
    cutY=-171.161095874;nx=-math.sqrt(3)/2;ny=.5;offset=nx*cx+ny*cy-.127;x=(offset-ny*cutY)/nx
    points=[[x,cutY],[x+500,cutY],[x+250,cutY+math.sqrt(3)*250]]
    clip=section([dict(kind='line',**{'from':v,'to':points[(i+1)%3]}) for i,v in enumerate(points)],392,thickness+height+5)
    shape=shape.intersect(clip).clean().Solids()[0]
    for group in ['vertical','base']:
        selected=[]
        for target in d['rounds']:
            if target['group']!=group or abs(target['xy'][1]+168.9261036)<=1e-5:continue
            v=cq.Vertex.makeVertex(*target['xy'],z+thickness+(height/2 if group=='vertical' else 0))
            selected.append(next(e for e in shape.Edges() if e.distance(v)<1e-5))
        shape=shape.fillet(3.175,selected)
    selected=[]
    for e in shape.Edges():
        if e.geomType()!='CIRCLE':continue
        q=midpoint(e);r=math.hypot(q.x-cx,q.y-cy)
        if abs(r-180.18125)<1e-5 and abs(q.z-(z+thickness+3.175))<1e-5 or abs(r-169.59891182775)<1e-5 and abs(q.z-(z+thickness+height))<1e-5:selected.append(e)
    shape=shape.fillet(3.175,selected).clean().Solids()[0]
    witnesses=[]
    for e in shape.Edges():
        p=midpoint(e)
        if abs(math.hypot(p.x-cx,p.y-cy)-165.1)<1e-5 and abs(p.z-(z+thickness+height))<1e-5:continue
        if abs(p.y-cutY)<1e-5 or abs(-(p.x-cx)*math.sqrt(3)/2+(p.y-cy)/2+.127)<1e-5 or p.z<z+1e-5:continue
        faces=e.ancestors(shape,'Face').Faces()
        if len(faces)==2 and abs(faces[0].normalAt(p).dot(faces[1].normalAt(p)))<.9999:witnesses.append((p,e.geomType()))
    def end(w):return w[0].x>0 and w[0].y<-150
    def near(a,b):return abs(a-b)<1e-5
    def inner(w):return end(w) and w[1]=='LINE' and near(w[0].y,-168.9261036) and w[0].x<5 and w[0].z<z+thickness+height-1
    def top(w):return end(w) and w[1]=='LINE' and near(w[0].y,-168.9261036) and near(w[0].z,z+thickness+height)
    def outer(w):return end(w) and w[1]=='LINE' and near(w[0].x,16.1951097544046) and w[0].z<z+thickness
    groups=[[w for w in witnesses if f(w)] for f in [inner,top,outer,lambda w:end(w) and near(w[0].x,16.1951097544046) and not outer(w),lambda w:not end(w)]]
    if any(len(g)!=1 for g in groups[:3]):raise ValueError('Unexpected end rib topology')
    for g in groups:
        selected=[]
        for point,kind in g:
            v=cq.Vertex.makeVertex(*point.toTuple());e=next((e for e in shape.Edges() if e.geomType()==kind and e.distance(v)<1e-5),None)
            if e is not None:selected.append(e)
        if selected:shape=shape.fillet(1,selected)
    for h in d['holes']:shape=shape.cut(cq.Solid.makeCylinder(h['radius'],thickness+.002,(*h['center'],393.2672)))
    return shape


def guard(baseThickness=6.35,holeScale=1,drill=True):
    if not math.isfinite(baseThickness) or baseThickness<2 or not math.isfinite(holeScale) or holeScale<=0:raise ValueError('Positive hole scale and at least 2 mm base required')
    d=data('platform027');stock=guard_stock(d);supports=[(f,f.Center(),f.Area()) for f in stock.Faces()]
    edges=[st.edge(e) for e in d['trims']['edges']];faces=[];bottom=None
    for desc in d['trims']['faces']:
        patch=next((p for p in d['patches'] if p['index']==desc['index']),None)
        analytic=next((p for p in d['analytics'] if p['index']==desc['index']),None)
        if analytic:support=st.support(dict(type='torus',origin=analytic['center'],axis=analytic['normal'],major=analytic['majorRadius'],minor=analytic['minorRadius']))
        elif patch:support=st.bspline_support(patch['grid'],patch['n'],patch['origin'],patch['fitScale'])
        else:
            def cost(s):return math.dist(s[1].toTuple(),desc['support']['center'])+abs(math.sqrt(s[2])-math.sqrt(desc['support']['area']))
            choice=min(supports,key=cost)
            if cost(choice)>.01:raise ValueError(f'Missing procedural support {desc["index"]}: {cost(choice)}')
            support=choice[0]
        cap=next((p for p in d['caps'] if p['index']==desc['index']),None)
        if cap:
            curves=[]
            for e in cap['edges']:
                h=st.fit_curve(e['points']);curves.append(st.reverse(h) if e['forward']!=e['sameSense'] else h)
            wires=[(True,st.wire(curves))]
        else:wires=[(w['outer'],st.wire([st.reverse(edges[e['edge']]) if e['reverse'] else edges[e['edge']] for e in w['edges'] if edges[e['edge']] is not None])) for w in desc['wires']]
        outer=next((w for flag,w in wires if flag),wires[0][1]);holes=[w for flag,w in wires if w is not outer]
        try:face=st.trimmed_face(support,outer,holes,desc['area'],desc['orientation'],fix=False,tolerance=.1)
        except Exception as e:raise ValueError(f'Guard face {desc["index"]}: {e}') from e
        faces.append(face)
        if desc['type']=='plane' and abs(desc['center'][2]-393.2682)<1e-7:bottom=face
    solid=st.sew_solid(faces,.01);delta=baseThickness-6.35
    if abs(delta)>1e-9:
        if bottom is None:raise ValueError('Missing base datum face')
        slab=cq.Solid.extrudeLinear(bottom.outerWire(),bottom.innerWires(),(0,0,-delta))
        if slab.Volume()<0:slab=st.reverse(slab)
        solid=(solid.fuse(slab) if delta>0 else solid.cut(slab)).translate((0,0,delta))
    if drill:
        for h in d['holes']:solid=solid.cut(cq.Solid.makeCylinder(h['radius']*holeScale,baseThickness+.002,(*h['center'],393.2672)))
    if not solid.isValid() or solid.Volume()<=0:raise ValueError('Invalid guard')
    return solid
