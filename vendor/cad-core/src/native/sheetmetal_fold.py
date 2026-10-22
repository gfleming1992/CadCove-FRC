"""Extract a tree of flat wall/bend zones using the external unfolder's geometry API.
No GUI, machine process planning, or replacement unfolding algorithm.
"""
import hashlib
import json
import math


def export_fold(shape, root_index, graph, bac, thickness, flat, alignment, output):
    import FreeCAD as App
    import Part
    import networkx as nx
    import SheetMetalNewUnfolder as sm
    if not nx.is_tree(graph):
        raise ValueError('3D fold preview requires an acyclic sheet face graph')
    if len(graph) > 128:
        raise ValueError('3D fold preview supports at most 128 sheet regions')
    paths = nx.single_source_shortest_path(graph, root_index)
    transforms, bends, zones, solids = {}, [], [], []
    normal = shape.Faces[root_index].normalAt(0, 0)
    for face_id, path in paths.items():
        face = shape.Faces[face_id]
        parent_matrix = App.Matrix()
        ancestors = []
        for ancestor in path[:-1]:
            if ancestor in transforms:
                parent_matrix = parent_matrix * transforms[ancestor]
                ancestors.append('bend-'+str(ancestor))
        own = None
        if face.Surface.TypeId == 'Part::GeomCylinder':
            edge = shape.Edges[graph.edges[path[-2], face_id]['label']]
            if edge.Curve.TypeId != 'Part::GeomLine':
                raise ValueError('3D fold requires straight bend boundaries')
            local, transforms[face_id], uvref = sm.compute_unbend_transform(face, edge, thickness, bac)
            edges, _ = sm.unroll_cylinder(face, uvref, bac, thickness, set())
            wires = sm.Edge2DCleanup.clean_and_structure_geometry(edges)
            region = Part.makeFace(wires, 'Part::FaceMakerBullseye').transformed(parent_matrix * local)
            direction = sm.BendDirection.from_face(face)
            sign = 1 if direction == sm.BendDirection.UP else -1
            angle = face.ParameterRange[1]-face.ParameterRange[0]
            if angle <= 1e-6 or angle > math.pi+1e-6:
                raise ValueError('3D fold preview supports bends up to 180 degrees')
            length = bac.get_bend_allowance(direction, face.Surface.Radius, thickness, angle)
            frame = alignment * parent_matrix * local
            origin = frame.multVec(App.Vector())
            axes = [(frame.multVec(App.Vector(*v))-origin) for v in [(1,0,0),(0,1,0),(0,0,1)]]
            own = 'bend-'+str(face_id)
            bends.append(dict(id=own, origin=list(origin), axes=[list(a) for a in axes],
                              angleDeg=sign*math.degrees(angle), lengthMm=length,
                              neutralOffsetMm=sign*(face.Surface.Radius-length/angle)))
        elif face.Surface.TypeId == 'Part::GeomPlane':
            region = face.transformed(parent_matrix)
        else:
            raise ValueError('Unsupported 3D fold surface')
        solid = region.extrude(normal * -thickness).transformed(alignment)
        if not solid.isValid() or len(solid.Solids) != 1:
            raise ValueError('Invalid flat fold region')
        name = 'zone-'+str(face_id)
        filename = name+'.step'
        solid.exportStep(str(output/filename))
        solids.append(solid)
        zones.append(dict(id=name, file=filename, sha256=hashlib.sha256((output/filename).read_bytes()).hexdigest(),
                          chain=ancestors+([own] if own else []), bend=own))
    union = solids[0].multiFuse(solids[1:]).removeSplitter() if len(solids)>1 else solids[0]
    error = union.cut(flat).Volume + flat.cut(union).Volume
    if abs(sum(s.Volume for s in solids)-flat.Volume)>max(1e-4,flat.Volume*1e-6) or error>max(1e-4,flat.Volume*1e-6):
        raise ValueError('Fold regions do not partition the validated flat pattern')
    shape.transformed(alignment).exportBrep(str(output/'fold-reference.brep'))
    result = dict(schema=1,units='mm-deg-s',thicknessMm=thickness,bends=bends,zones=zones,
                  validation=dict(flatDifferenceMm3=error), manufacturingSequence=False)
    (output/'fold-definition.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    return dict(file='fold-definition.json',sha256=hashlib.sha256((output/'fold-definition.json').read_bytes()).hexdigest(),zones=len(zones),bends=len(bends))
