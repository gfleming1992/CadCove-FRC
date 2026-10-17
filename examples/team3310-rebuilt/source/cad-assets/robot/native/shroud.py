"""Native machined ball-duct shroud with local fitted lip/toe surfaces."""

import math
import cadquery as cq
from native.brackets import cylinder, data, rebuilt_cylinders
from native.manufacturing import fuse
from native.surface_tools import (
    wire,
    fit_curve,
    bspline_support,
    support,
    trimmed_face,
    sew_solid,
    reverse,
)

V = cq.Vector
Z = 46.213031824631
CY = -13.07896185296
R = 16.634961852962


def box(x0, x1, y0, y1, z0, z1):
    return cq.Solid.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0))


def poly_extrude(points, vec):
    return cq.Solid.extrudeLinear(
        cq.Wire.makePolygon([V(*p) for p in points], close=True), [], V(*vec)
    )


def half(p, n):
    n = V(*n).normalized()
    u = V(0, 1, 0)
    v = V(-n.z, 0, n.x)
    origin = V(*p)
    return poly_extrude(
        [
            (origin + u * a + v * c).toTuple()
            for a, c in [(-100, -100), (100, -100), (100, 100), (-100, 100)]
        ],
        (n * 200).toTuple(),
    )


def stock(mountHoleRadius=3.429):
    s = fuse(
        [
            cylinder(R, Z - 5.08, [0, CY, 5.08]),
            box(0, R, CY, 3.556, 5.08, Z),
            box(-40, 0, -24.13, -2.413, 5.08, Z),
            box(6.858, 36.83, 2.032, 24.13, 5.08, Z),
        ]
    )
    for p, n in [
        (
            [-36.89755113412104, -13.2715, 16.971532424405996],
            [-0.9999921491032121, 0, -0.00396254109621884],
        ),
        (
            [28.47531652748442, 11.5608838189339, 39.38798524895858],
            [0.7071067811865476, 0, 0.7071067811865476],
        ),
        (
            [-33.88085246565831, -12.170456622344403, 34.05753042622286],
            [-0.7085063659190968, 0, 0.7057044207400964],
        ),
    ]:
        s = s.cut(half(p, n))
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).xmin < -30
        and (q.zlen > 1 or q.xmax < -36 and q.zmin > 30 and q.zmax < 32)
    ]
    s = s.fillet(5.08, es)
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).zlen > 1
        and q.ylen < 1e-6
        and q.xlen < 1e-6
        and abs(q.xmin) < 20
        and not (
            abs(q.xmin - R) < 1e-6
            and abs(q.ymin - CY) < 1e-6
            or abs(q.xmin) < 1e-6
            and abs(q.ymin - 3.556) < 1e-6
        )
    ]
    s = s.fillet(5.08, es)
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).xmax > 30
        and (q.zlen > 1 or abs(q.xmin) > 36 and q.zmin > 30 and q.zmax < 32)
    ]
    s = s.fillet(5.08, es)
    s = s.cut(box(-19.9136, 0, -24.13, 50, 0, 28.941031824631)).cut(
        box(0, 19.939, -24.13, 50, 0, 24.623031824631)
    )
    poly = [
        [-6.956625694969, 0],
        [-6.956625694969, 29.708903306169],
        [-4.08187334908, 34.021031824631],
        [4.08187334908, 34.021031824631],
        [6.858, 29.856841848614],
        [6.858, 0],
    ]
    s = s.cut(poly_extrude([[x, CY, z] for x, z in poly], [0, 60, 0])).cut(
        box(-60, 60, -50, -24.13, 0, 17.003031824631)
    )
    s = s.cut(
        box(-40, 0, -50, -24.13, 5.08, 28.941031824631).cut(cylinder(R, 60, [0, CY, 0]))
    )
    relief = cylinder(5.08, 40, [-40, 2.667, 28.941031824631], [1, 0, 0]).intersect(
        box(-40, 0, -2.413, 2.667, 28.941031824631, 34.021031824631)
    )
    s = s.cut(relief).cut(box(-40, 0, 2.667, 50, 0, 34.021031824631))
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).zlen < 1e-6
        and abs(q.zmin - 5.08) < 1e-6
        and q.xlen < 1e-6
        and (abs(q.xmin - 19.939) < 1e-6 or abs(q.xmin + 19.9136) < 1e-6)
    ]
    s = s.fillet(3.048, es)
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).zlen > 1
        and q.xlen < 1e-6
        and q.ylen < 1e-6
        and abs(q.ymin + 24.13) < 1e-6
        and abs(abs(q.xmin) - 12.43368455938) < 1e-5
    ]
    s = s.fillet(0.396875, es)
    for x, y in [(-28.575, -13.97), (28.575, 13.97)]:
        s = s.cut(cylinder(mountHoleRadius, 3.17502, [x, y, 5.07999]))
        r = 5.75625 / math.cos(math.pi / 6)
        s = s.cut(
            poly_extrude(
                [
                    [
                        x + r * math.cos(math.pi / 6 + i * math.pi / 3),
                        y + r * math.sin(math.pi / 6 + i * math.pi / 3),
                        8.255,
                    ]
                    for i in range(6)
                ],
                [0, 0, 50],
            )
        )
    s = s.cut(cylinder(11.191875, 50, [0, CY, 0]))
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).zlen < 1e-6
        and abs(q.zmin - Z) < 1e-6
        and e.geomType() == "CIRCLE"
        and abs(q.xmax - 11.191875) < 1e-5
    ]
    s = s.chamfer(2.143125, None, es)
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).zlen < 1e-6 and abs(q.zmin - Z) < 1e-6
    ]
    return s.chamfer(0.5, None, es)


from OCP.gp import gp_Ax2, gp_Pnt, gp_Dir, gp_Circ, gp_Ax3, gp_Cone
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace


def compact_solid(d, notch=False):
    edges = []
    for e in d["edges"]:
        p = e["points"]
        kind = e["type"]
        if max(math.dist(q, p[0]) for q in p) < 1e-7:
            edges.append(None)
            continue
        if kind == "line":
            edge = cq.Edge.makeLine(*[V(*q) for q in p])
        elif kind == "circle":
            if not e.get("full"):
                edge = cq.Edge.makeThreePointArc(*[V(*q) for q in p])
            else:
                x = [(v - o) / e["radius"] for v, o in zip(p[0], e["origin"])]
                edge = cq.Edge(
                    BRepBuilderAPI_MakeEdge(
                        gp_Circ(
                            gp_Ax2(
                                gp_Pnt(*e["origin"]), gp_Dir(*e["axis"]), gp_Dir(*x)
                            ),
                            e["radius"],
                        )
                    ).Edge()
                )
        elif not e.get("closed") and all(
            math.dist(q, [a + (b - a) * i / (len(p) - 1) for a, b in zip(p[0], p[-1])])
            < 1e-7
            for i, q in enumerate(p)
        ):
            edge = cq.Edge.makeLine(V(*p[0]), V(*p[-1]))
        else:
            o = p[0]
            pts = p[:-1] if e.get("closed") else p
            edge = (
                cq.Edge.makeSpline(
                    [V(*[(v - a) * 1000 for v, a in zip(q, o)]) for q in pts],
                    periodic=e.get("closed", False),
                    tol=1e-6,
                )
                .scale(0.001)
                .translate(o)
            )
        edges.append(edge)
    faces = []
    for d in d["faces"]:
        ws = []
        for w in d["wires"]:
            es = []
            for e in w["edges"]:
                i = e["index"]
                i = 34 if notch and i in [39, 40] else i
                edge = edges[i]
                if edge is not None:
                    es.append(reverse(edge) if e.get("reverse") else edge)
            ws.append((w["outer"], wire(es)))
        outer = next(w for o, w in ws if o)
        holes = [w for o, w in ws if not o]
        t = d["type"]
        if t == "plane":
            sup = cq.Face.makeFromWires(outer)
        elif t in ["cylinder", "torus", "cone"]:
            p = d["support"]
            l = p["linear"]
            axis = [l[2], l[5], l[8]]
            radial = [l[0], l[3], l[6]]
            if t == "cone":
                angle = math.atan2(p["radius1"] - p["radius0"], p["height"])
                sup = cq.Face(
                    BRepBuilderAPI_MakeFace(
                        gp_Cone(
                            gp_Ax3(
                                gp_Pnt(*p["origin"]), gp_Dir(*axis), gp_Dir(*radial)
                            ),
                            angle,
                            p["radius0"],
                        )
                    ).Face()
                )
            else:
                sup = support(
                    dict(
                        type=t,
                        origin=p["origin"],
                        axis=axis,
                        radial=radial,
                        radius=p.get("radius0"),
                        major=p.get("major"),
                        minor=p.get("minor"),
                    )
                )
        else:
            p = d["support"]
            sup = bspline_support(p["grid"], p["n"], p["origin"], p["scale"])

        if t == "plane":
            f = cq.Face.makeFromWires(outer, holes)
            from OCP.TopAbs import TopAbs_REVERSED

            if (f.wrapped.Orientation() == TopAbs_REVERSED) != (
                d["orientation"] == "reversed"
            ):
                f = reverse(f)
            if not f.isValid() or abs(f.Area() - d["area"]) > 0.02:
                raise ValueError(f"Invalid planar trim {d['index']}: {f.Area()}")
        else:
            f = trimmed_face(
                sup,
                outer,
                holes,
                area=d["area"],
                orientation=d["orientation"],
                fix=False,
                tolerance=0.02,
            )
        faces.append(f)
    return sew_solid(faces, 1e-5)


def shroud(mountHoleRadius=3.429):
    if not math.isfinite(mountHoleRadius) or not 0 < mountHoleRadius < 5.75625:
        raise ValueError("Mounting bore must fit hex pocket")
    lower = stock(mountHoleRadius).intersect(box(-60, 60, -60, 60, 0, 38.5))
    # Replace the two cylinder trims and sew their shared boundary natively.
    td = data("shroud-toe-compact-data")
    lower = rebuilt_cylinders(lower, td["faces"], 0.0001)
    upper = compact_solid(data("shroud-rim-compact-data"))
    faces = [
        f
        for s in [lower, upper]
        for f in s.Faces()
        if not (
            abs(f.BoundingBox().zmin - 38.5) < 1e-5
            and abs(f.BoundingBox().zmax - 38.5) < 1e-5
        )
    ]
    return sew_solid(faces, 0.0001)
