"""Machined annular turret rails, native OCCT feature construction."""

import math
import cadquery as cq
from native.manufacturing import build_prismatic_part as prism, fuse
from native.brackets import midpoint, cylinder, data
from native.surface_tools import (
    bspline_support,
    support,
    fit_curve,
    trimmed_face,
    sew_solid,
    reverse,
    wire,
)

V = cq.Vector
C = (-162.5586951228, -173.4981036)
N = (-268.4195451227, -278.5779036)
Z = 393.2682
TOP = 399.6182


def profile(outline, z, depth, cutouts=None, holeScale=1):
    return prism(
        dict(
            origin=[0, 0, z],
            normal=[0, 0, 1],
            u=[1, 0, 0],
            v=[0, 1, 0],
            direction=[0, 0, 1],
            depth=depth,
            outline=outline,
            cutouts=cutouts or [],
        ),
        holeScale=holeScale,
    )


def lower(holeScale=1, nutAcrossFlats=9.779, b=False):
    if not 0.9 <= holeScale <= 1.1 or not 9 <= nutAcrossFlats <= 10.5:
        raise ValueError("Unsupported rail bore or nut dimension")
    d = data("rail600004b-lower-candidate" if b else "rail600004-lower-candidate")
    center = d["center"]
    templates = d["templates"]

    def contour(instance, nut=False):
        index, step = instance
        a = step * math.pi / 8
        c = math.cos(a)
        s = math.sin(a)
        es = [
            {
                k: (
                    [center[0] + v[0] * c - v[1] * s, center[1] + v[0] * s + v[1] * c]
                    if isinstance(v, list)
                    else v
                )
                for k, v in e.items()
            }
            for e in templates[index]
        ]
        if nut and len(es) == 6 and all(e["kind"] == "line" for e in es):
            mid = [sum(e["from"][i] for e in es) / 6 for i in [0, 1]]
            es = [
                {
                    **e,
                    **{
                        key: [
                            mid[i] + (v - mid[i]) * nutAcrossFlats / 9.779
                            for i, v in enumerate(e[key])
                        ]
                        for key in ["from", "to"]
                    },
                }
                for e in es
            ]
        return es

    bodies = [
        profile(
            contour(l["outline"]),
            l["z"],
            l["depth"],
            [contour(i, True) for i in l["cutouts"]],
            holeScale,
        )
        for l in d["layers"]
    ]
    s = fuse(bodies)
    at = V(*center, 380.5682)
    tool = cq.Solid.makeCylinder(180, 1.5875, at).cut(
        cq.Solid.makeCone(150.8125, 152.4, 1.5875, at)
    )
    s = s.cut(tool)
    if b:
        center = (-268.4195451227, -68.4183036)
        tool = cylinder(14.2875, 1.5875, [*center, 383.7432]).cut(
            cq.Solid.makeTorus(14.2875, 1.5875, V(*center, 385.3307))
        )
        tool = tool.intersect(cylinder(149.225, 1.5875, [*C, 383.7432]))
        s = s.cut(tool).mirror((0, 1, 0), (0, -173.4981036, 0))
    return s


def upper(b=False):
    s = profile(data("rail600004-upper-candidate")["outline"], Z, 6.35)
    if b:
        half = math.pi / 360
        inside = 147.6375
        outside = 154.78714382014

        def xy(r, a):
            return [C[0] + r * math.cos(a), C[1] + r * math.sin(a)]

        ol = [
            dict(
                kind="arc",
                **{
                    "from": xy(outside, -half),
                    "mid": xy(outside, 0),
                    "to": xy(outside, half),
                },
            ),
            dict(kind="line", **{"from": xy(outside, half), "to": xy(inside, half)}),
            dict(
                kind="arc",
                **{
                    "from": xy(inside, half),
                    "mid": xy(inside, 0),
                    "to": xy(inside, -half),
                },
            ),
            dict(kind="line", **{"from": xy(inside, -half), "to": xy(outside, -half)}),
        ]
        s = s.fuse(profile(ol, Z, 6.35)).clean()
    roll = -310.9899451227
    limiter = cq.Solid.makeBox(400, 400, 20, V(roll, -450, Z)).fuse(
        cylinder(6.35, 400, [roll, -450, Z], [0, 1, 0])
    )
    s = s.intersect(limiter).cut(cylinder(11.1506, 6.35, [*N, Z]))
    for r0, r1, z in [(163.5125, 165.1, Z), (165.1, 163.5125, 398.0307)]:
        at = V(*C, z)
        tool = cq.Solid.makeCylinder(180, 1.5875, at).cut(
            cq.Solid.makeCone(r0, r1, 1.5875, at)
        )
        s = s.cut(tool)
    edges = []
    for e in s.Edges():
        q = e.BoundingBox()
        p = midpoint(e)
        notch = math.hypot(p.x - N[0], p.y - N[1])
        vertical = q.xlen < 1e-5 and q.ylen < 1e-5 and q.zlen > 1
        onTop = abs(q.zmin - TOP) < 1e-5 and abs(q.zmax - TOP) < 1e-5
        if abs(notch - 11.1506) < 1e-4 and (vertical or onTop):
            edges.append(e)
    return s.fillet(1.5875, edges)


def stock(holeScale=1, nutAcrossFlats=9.779, b=False):
    s = (
        lower(holeScale, nutAcrossFlats, b)
        .fuse(upper(b))
        .clean()
        .cut(cylinder(12.7, 1.778, [*N, Z]))
    )
    es = []
    for e in s.Edges():
        q = e.BoundingBox()
        flat = q.zlen < 1e-5
        cap = (
            abs(q.ymin + 219.5356036) < 1e-4
            and abs(q.ymax + 219.5356036) < 1e-4
            and not (flat and abs(q.zmin - Z) < 1e-4 and q.xmin > -310)
        )
        bottom = (
            flat
            and abs(q.zmin - Z) < 1e-4
            and abs(q.xmin + 317.3399451227) < 1e-4
            and abs(q.xmax + 317.3399451227) < 1e-4
        )
        if cap or bottom:
            es.append(e)
    s = s.fillet(1.5875, es)
    for z, left in [(TOP, False), (Z, True)]:
        es = []
        for e in s.Edges():
            q = e.BoundingBox()
            p = midpoint(e)
            if (
                abs(q.zmin - z) < 1e-4
                and abs(q.zmax - z) < 1e-4
                and (not left or q.xmax < -270)
                and e.geomType() == "CIRCLE"
                and abs(math.hypot(p.x - C[0], p.y - C[1]) - 147.6375) < 1e-4
            ):
                es.append(e)
        if not es:
            raise ValueError("Missing rail root fillet")
        s = s.fillet(1.016, es)
    s = s.cut(cylinder(12.7, 1.778, [*N, Z]))
    for x, y in [
        (-307.7579121511, -233.641588539),
        (-222.7021800618, -318.6973206283),
        (-102.4152101837, -318.6973206283),
        (-51.42802562456, -284.6287730982),
        (-17.35947809449, -233.641588539),
    ]:
        s = s.cut(cylinder(2.4892 * holeScale, 6.35, [x, y, Z])).cut(
            cylinder(4.7625 * holeScale, TOP - 394.7922, [x, y, 394.7922])
        )
    return s


def rail(holeScale=1, nutAcrossFlats=9.779, b=False):
    s = stock(holeScale, nutAcrossFlats, b)
    for ri, r in enumerate(data("rail600004-region-data")):
        x0, x1, y0, y1, z0, z1 = r["box"]
        s = s.cut(cq.Solid.makeBox(x1 - x0, y1 - y0, z1 - z0, V(x0, y0, z0)))
        faces = [
            f
            for f in s.Faces()
            if f.geomType() != "PLANE"
            or not any(
                abs(a - b) < 1e-6
                for a, b in zip(
                    [f.Center().x] * 2 + [f.Center().y] * 2 + [f.Center().z] * 2,
                    [x0, x1, y0, y1, z0, z1],
                )
            )
        ]
        for d in r["faces"]:
            t = d["type"]
            sup = None
            if t == "bspline":
                sup = bspline_support(d["grid"], d["n"], d["sample"], 1000)
            elif d.get("analytic"):
                a = d["analytic"]
                l = a["linear"]
                sup = support(
                    dict(
                        type=t,
                        origin=a["origin"],
                        axis=[l[2], l[5], l[8]],
                        radial=[l[0], l[3], l[6]],
                        radius=a["major"],
                        major=a["major"],
                        minor=a.get("minor"),
                    )
                )
            ws = []
            for w in d["wires"]:
                es = []
                for e in w["edges"]:
                    if math.dist(e["points"][0], e["points"][-1]) < 1e-8:
                        continue
                    edge = (
                        cq.Edge.makeLine(*[V(*p) for p in e["points"]])
                        if e["type"] == "line"
                        else fit_curve(e["points"])
                    )
                    es.append(reverse(edge) if e.get("reverse") else edge)
                ws.append((w["outer"], wire(es)))
            outer = next(w for o, w in ws if o)
            if sup is None:
                sup = cq.Face.makeFromWires(outer)
            f = trimmed_face(sup, outer, area=d["area"], fix=False, tolerance=0.001)
            if f.normalAt(V(*d["sample"])).dot(V(*d["normal"])) < 0:
                f = reverse(f)
            faces.append(f)
        s = sew_solid(faces, 1e-5)
        if not s.isValid():
            raise ValueError(f"Invalid rail patch {ri}")
    return s.mirror((0, 1, 0), (0, -173.4981036, 0)) if b else s
