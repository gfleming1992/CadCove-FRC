"""Native machined turret mounting brackets, millimetres."""

import json, math
from pathlib import Path
import cadquery as cq
from native.manufacturing import build_prismatic_part as prism, fuse

V = cq.Vector


def data(name):
    return json.loads((Path(__file__).parent / "data" / f"{name}.json").read_text())


def midpoint(e):
    a = e._geomAdaptor()
    return e.positionAt((a.FirstParameter() + a.LastParameter()) * 0.5, "parameter")


def cylinder(radius, height, at, axis=(0, 0, 1)):
    return cq.Solid.makeCylinder(radius, height, V(*at), V(*axis))


def bracket017_stock(frontMountHoleRadius=1.7272):
    if not math.isfinite(frontMountHoleRadius) or frontMountHoleRadius <= 0:
        raise ValueError("Mount hole radius must be positive")
    d = data("bracket017-profile-parametric")
    s = prism(d["footprint"], depth=33.3375)
    s = s.cut(
        cylinder(166.68749999999, 22.9075, [-162.5586951227, -173.4981036, 404.6982])
    )
    s = s.cut(
        fuse(
            [
                cylinder(
                    frontMountHoleRadius if i == 0 else h["radius"],
                    h["length"],
                    h["at"],
                    h["axis"],
                )
                for i, h in enumerate(d["crossHoles"])
            ]
        )
    ).clean()
    p = [V(*p) for p in d["lipPoints"]]
    cx = -162.5586951227
    cy = -173.4981036
    a = V(cx, cy, p[0].z)
    z = V(cx, cy, p[-1].z)
    wire = cq.Wire.assembleEdges(
        [
            cq.Edge.makeLine(a, p[0]),
            cq.Edge.makeSpline(p, tol=1e-6),
            cq.Edge.makeLine(p[-1], z),
            cq.Edge.makeLine(z, a),
        ]
    )
    tool = cq.Solid.revolve(wire, [], 360, V(cx, cy, 0), V(cx, cy, 1))
    s = s.cut(tool)
    edges = [
        e
        for e in s.Edges()
        if any((midpoint(e) - V(*p)).Length < 0.001 for p in d["roundLocations"])
    ]
    if len(edges) != len(d["roundLocations"]):
        raise ValueError(f"Bracket017 round selection: {len(edges)}")
    return s.fillet(1.016, edges)


from native.surface_tools import (
    bspline_support,
    fit_curve,
    trimmed_face,
    sew_solid,
    reverse,
    wire,
)
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.gp import gp_Vec, gp_Ax2, gp_Pnt, gp_Dir, gp_Circ
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge


def blend_tool(d, direction, offset):
    sup = bspline_support(d["grid"], d["n"])
    edges = [
        (
            cq.Edge.makeLine(*[V(*p) for p in e["points"]])
            if e["type"] == "line"
            else cq.Edge.makeSpline([V(*p) for p in e["points"]], tol=1e-6)
        )
        for e in d["curves"]
    ]
    f = trimmed_face(sup, wire(edges), fix=False)
    s = cq.Shape.cast(BRepPrimAPI_MakePrism(f.wrapped, gp_Vec(*direction)).Shape())
    if s.Volume() < 0:
        s = reverse(s)
    return s.translate(offset)


def bracket017(frontMountHoleRadius=1.7272):
    s = bracket017_stock(frontMountHoleRadius)
    s = s.fuse(
        blend_tool(
            data("bracket017-rear-blend-data"),
            [-2, 0.2, -0.2],
            [0.001, -0.0001, 0.0001],
        )
    )
    s = s.cut(
        blend_tool(data("bracket017-front-blend-data"), [0, 2, 2], [0, -0.001, -0.001])
    )
    d = data("bracket017-lip-surface-data")
    faces = s.Faces()
    matches = [
        f
        for f in faces
        if abs(f.Area() - d["area"]) < 0.1
        and abs(f.BoundingBox().xmin + 315.4552697) < 0.05
        and abs(f.BoundingBox().ymin + 217.8380619) < 0.05
    ]
    if len(matches) != 1:
        raise ValueError(f"Ambiguous bracket lip {len(matches)}")
    sup = bspline_support(d["grid"], d["n"], d["origin"], 1000)
    f = trimmed_face(
        sup,
        matches[0].outerWire(),
        area=d["area"],
        orientation=d["orientation"],
        fix=False,
        tolerance=0.01,
    )
    s = sew_solid([q for q in faces if q is not matches[0]] + [f], 1e-6)
    return s


from native.surface_tools import support
from OCP.ShapeFix import ShapeFix_Solid


def rebuilt_cylinders(s, descriptors, tolerance=0.001, heal=False):
    # Share the average sampled seam between intersecting bores.
    import copy

    ds = copy.deepcopy(descriptors)
    for d in ds:
        for e in d["edges"]:
            if not e.get("sourceEdge"):
                continue
            other = next(
                (
                    q
                    for f in descriptors
                    for q in f["edges"]
                    if q.get("sourceEdge") == e["sourceEdge"]
                    and q["points"] != e["points"]
                ),
                None,
            )
            if other:
                pts = other["points"]
                if math.dist(e["points"][0], pts[0]) > math.dist(
                    e["points"][0], pts[-1]
                ):
                    pts = list(reversed(pts))
                e["points"] = [
                    [(a + b) / 2 for a, b in zip(p, q)]
                    for p, q in zip(e["points"], pts)
                ]
    fs = s.Faces()
    new = {}
    shared = {}
    for d in ds:
        # Match by cylinder support if face order differs between OCCT versions.
        linear = d["linear"]
        axis = [linear[2], linear[5], linear[8]]
        radial = [linear[0], linear[3], linear[6]]
        sup = support(
            dict(
                type="cylinder",
                origin=d["origin"],
                radius=d["radius"],
                axis=axis,
                radial=radial,
            )
        )
        es = []
        for e in d["edges"]:
            key = e.get("sourceEdge")
            if key and key in shared:
                edge = shared[key]
            elif e["type"] == "line":
                edge = cq.Edge.makeLine(*[V(*p) for p in e["points"]])
            elif e["type"] == "arc":
                edge = cq.Edge.makeThreePointArc(*[V(*p) for p in e["points"]])
            elif e["type"] == "circleFull":
                l = e["linear"]
                edge = cq.Edge(
                    BRepBuilderAPI_MakeEdge(
                        gp_Circ(
                            gp_Ax2(
                                gp_Pnt(*e["origin"]),
                                gp_Dir(l[2], l[5], l[8]),
                                gp_Dir(l[0], l[3], l[6]),
                            ),
                            e["radius"],
                        )
                    ).Edge()
                )
            else:
                p = e["points"][:-1] if e.get("closed") else e["points"]
                o = p[0]
                edge = (
                    cq.Edge.makeSpline(
                        [V(*[(v - a) * 1000 for v, a in zip(q, o)]) for q in p],
                        periodic=e.get("closed", False),
                        tol=1e-6,
                    )
                    .scale(0.001)
                    .translate(o)
                )
            if key:
                shared[key] = edge
            es.append(edge)
        ws = [
            (
                w["outer"],
                wire(
                    [
                        reverse(es[e["edge"]]) if e.get("reverse") else es[e["edge"]]
                        for e in w["edges"]
                    ]
                ),
            )
            for w in d["wires"]
        ]
        outer = next((w for o, w in ws if o), ws[0][1])
        holes = [w for o, w in ws if not o]
        face = trimmed_face(
            sup,
            outer,
            holes,
            area=d["area"],
            orientation=d["orientation"],
            fix=False,
            tolerance=0.2,
        )
        idx = d["targetIndex"]
        if idx >= len(fs) or fs[idx].geomType() != "CYLINDER":
            raise ValueError(f"Stock cylinder topology changed at {idx}")
        new[idx] = face
    s = sew_solid([new.get(i, f) for i, f in enumerate(fs)], tolerance)
    if heal:
        fixer = ShapeFix_Solid(s.wrapped)
        fixer.Perform()
        s = cq.Shape.cast(fixer.Solid())
    return s


# Native OCCT produces valid exact intersecting bore trims directly;
# the browser-kernel seam replacement/partition is intentionally unnecessary.


def bracket017m(
    counterboreDiameter=7.9375, rearPilotRadius=2.2479, frontMountHoleRadius=1.7272
):
    if not counterboreDiameter / 2 > rearPilotRadius > 0:
        raise ValueError("Counterbore must exceed pilot")
    s = bracket017(frontMountHoleRadius).mirror((0, 1, 0), (0, -173.4981036, 0))
    s = s.cut(
        cylinder(
            counterboreDiameter / 2,
            28.68504173654003,
            [-319.913, -100.4731036, 399.6182],
            [0, -1, 0],
        )
    )
    return s.cut(
        cylinder(
            rearPilotRadius,
            15.637958263456,
            [-319.913, -144.7961036, 399.6182],
            [0, 1, 0],
        )
    )


def bracket022(frontMountHoleRadius=1.7272):
    if not math.isfinite(frontMountHoleRadius) or frontMountHoleRadius <= 0:
        raise ValueError("Invalid mounting bore radius")
    from native.shroud import compact_solid, box

    profile = data("bracket022-profile-data")
    bodies = []
    cx = -342.138
    cz = 377.3932
    r = 6.35
    z0 = 372.6307
    z1 = 386.9182
    x0 = -348.488
    x1 = -310
    xe = cx - math.sqrt(r * r - (z0 - cz) ** 2)
    a = math.atan2(z0 - cz, xe - cx)
    am = (a - math.pi) / 2
    points = [[x0, z1], [x1, z1], [x1, z0], [xe, z0]]
    ol = [
        dict(kind="line", **{"from": p, "to": q}) for p, q in zip(points, points[1:])
    ] + [
        dict(
            kind="arc",
            **{
                "from": [xe, z0],
                "mid": [cx + r * math.cos(am), cz + r * math.sin(am)],
                "to": [x0, cz],
            },
        ),
        dict(kind="line", **{"from": [x0, cz], "to": [x0, z1]}),
    ]
    limiter = prism(
        dict(
            origin=[0, -250, 0],
            normal=[0, -1, 0],
            u=[1, 0, 0],
            v=[0, 0, 1],
            direction=[0, 1, 0],
            depth=60,
            outline=ol,
            cutouts=[],
        )
    )
    for front in [-196.9931036, -195.7231036]:
        c = [-162.5586951228, -173.4981036]
        r = 166.6875
        back = -246.5231036

        def x(y):
            return c[0] - math.sqrt(r * r - (y - c[1]) ** 2)

        ol = [
            dict(kind="line", **{"from": [-348.488, front], "to": [-348.488, back]}),
            dict(kind="line", **{"from": [-348.488, back], "to": [x(back), back]}),
            dict(
                kind="arc",
                **{
                    "from": [x(back), back],
                    "mid": [x(-222), -222],
                    "to": [x(front), front],
                },
            ),
            dict(kind="line", **{"from": [x(front), front], "to": [-348.488, front]}),
        ]
        s = prism({**profile, "outline": ol, "cutouts": []}).intersect(limiter)
        es = [
            e
            for e in s.Edges()
            if (q := e.BoundingBox()).zmin < 386.9181
            and not (
                abs(q.zmin - 377.3932) < 1e-5
                and abs(q.zmax - 377.3932) < 1e-5
                and q.ylen > 1
            )
        ]
        bodies.append(s.fillet(3.175, es))
    s = (
        bodies[0]
        .fuse(bodies[1].intersect(box(-335.661, -285.661, -270, -170, 365, 395)))
        .clean()
    )
    window = prism(
        {
            **profile,
            "origin": [0, 0, 371.6307],
            "depth": 16.2875,
            "outline": profile["cutouts"][0],
            "cutouts": [],
        }
    )
    s = s.cut(window)
    faceCompound = cq.Compound.makeCompound(window.Faces())
    es = [
        e
        for e in s.Edges()
        if (q := e.BoundingBox()).zlen < 1e-5
        and abs(q.zmin - 372.6307) < 1e-5
        and cq.Vertex.makeVertex(*midpoint(e).toTuple()).distance(faceCompound) < 1e-5
    ]
    s = s.fillet(0.508, es)
    base = s.cut(box(-336.3, -335.02, -203, -193, 372, 388))
    cap = compact_solid(data("bracket022-notch-compact-data"), True)

    def interface(f):
        if f.geomType() != "PLANE":
            return False
        q = f.BoundingBox()
        return (
            (
                abs(q.xmin + 336.3) < 1e-5
                and abs(q.xmax + 336.3) < 1e-5
                or abs(q.xmin + 335.02) < 1e-5
                and abs(q.xmax + 335.02) < 1e-5
            )
            and q.ymin >= -203 - 1e-5
        ) or (
            abs(q.ymin + 203) < 1e-5
            and abs(q.ymax + 203) < 1e-5
            and q.xmin >= -336.3 - 1e-5
            and q.xmax <= -335.02 + 1e-5
        )

    s = sew_solid(
        [f for body in [base, cap] for f in body.Faces() if not interface(f)], 0.0001
    )
    for x, y in [(-322.2346819876, -240.1731036), (-332.867, -200.4856036)]:
        s = s.cut(
            cylinder(
                frontMountHoleRadius if y > -210 else 1.7272, 16.2875, [x, y, 371.6307]
            )
        )
    s = s.translate([342.138, 240.1731036, -377.3932])
    s = s.cut(cylinder(1.7272, 16.2875, [0, 0, -5.7625])).cut(
        cylinder(1.7272, 60, [0, -9.8268964, 0], [0, 1, 0])
    )
    return s.translate([-342.138, -240.1731036, 377.3932])


def bracket022m(frontMountHoleRadius=1.7272, counterboreDiameter=7.9375):
    if not math.isfinite(counterboreDiameter) or counterboreDiameter <= 0:
        raise ValueError("Invalid counterbore diameter")
    return (
        bracket022(frontMountHoleRadius)
        .mirror((0, 1, 0), (0, -173.4981036, 0))
        .cut(
            cylinder(
                counterboreDiameter / 2,
                50,
                [-342.138, -142.0656036, 377.3932],
                [0, 1, 0],
            )
        )
    )
