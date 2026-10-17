import cadquery as cq


def build_prismatic_part(profile, depth=None, holeScale=1):
    depth = profile['depth'] if depth is None else depth
    if depth <= 0 or holeScale <= 0:
        raise ValueError('Depth and hole scale must be positive')
    def point(p):
        return cq.Vector(*[a+p[0]*u+p[1]*v for a,u,v in zip(profile['origin'],profile['u'],profile['v'])])
    def loop(edges, hole=False):
        curves=[]
        for e in edges:
            kind=e['kind']
            if kind=='line': curves.append(cq.Edge.makeLine(point(e['from']),point(e['to'])))
            elif kind=='arc': curves.append(cq.Edge.makeThreePointArc(point(e['from']),point(e['mid']),point(e['to'])))
            elif kind=='bezier': curves.append(cq.Edge.makeBezier([point(p) for p in e['poles']]))
            elif kind=='circle': curves.append(cq.Edge.makeCircle(e['radius']*(holeScale if hole else 1),point(e['center']),cq.Vector(*profile['normal'])))
            else: raise ValueError(kind)
        return cq.Wire.assembleEdges(curves)
    outer=loop(profile['outline']);inners=[loop(e,True) for e in profile['cutouts']]
    shape=cq.Solid.extrudeLinear(outer,inners,cq.Vector(*[v*depth for v in profile['direction']]))
    tools=[cq.Solid.makeCylinder(h['radius']*holeScale,h['length']+.00002,cq.Vector(*[p-a*.00001 for p,a in zip(h['at'],h['axis'])]),cq.Vector(*h['axis'])) for h in profile.get('crossHoles',[])]
    if tools: shape=shape.cut(fuse(tools))
    return shape


def fuse(shapes):
    if not shapes:
        raise ValueError('No shapes to fuse')
    return shapes[0].fuse(*shapes[1:]).clean() if len(shapes)>1 else shapes[0]


def sharp_edges(shape):
    result=[]
    for edge in shape.Edges():
        faces=edge.ancestors(shape,'Face').Faces()
        if len(faces)==2:
            curve=edge._geomAdaptor()
            point=edge.positionAt((curve.FirstParameter()+curve.LastParameter())*.5,'parameter')
            a,b=[face.normalAt(point) for face in faces]
            if abs(a.dot(b))<.999:
                result.append(edge)
    return result
